(function () {
  "use strict";

  const api = window.PluginApi;
  if (!api) {
    console.warn("[clips] PluginApi is not available.");
    return;
  }

  const React = api.React;
  const { Nav } = api.libraries.Bootstrap;
  const { NavLink } = api.libraries.ReactRouterDOM;
  const {
    faArrowDown,
    faArrowUp,
    faPlay,
    faPlayCircle,
    faVolumeMute,
    faVolumeUp,
  } = api.libraries.FontAwesomeSolid;
  const useSettings = api.hooks.useSettings;
  const pluginId = "clips";
  const pluginSettingIds = ["clips", "Clips"];
  const recommendationSourceSetting = "recommendationSource";
  const unmuteOnEnterSetting = "unmuteOnEnter";
  const clipsStoragePrefix = "clips.";
  const defaultClipsSettings = {
    recommendationSource: "random",
    unmuteOnEnter: false,
  };
  const routePath = "/plugin/clips";
  const maxHistory = 50;
  const recommendationLimit = 20;
  const swipeThreshold = 42;
  const wheelThreshold = 36;
  const hybridStoragePrefix = "stashHybridRecommendations.";
  const hybridEngineTargets = {
    "linux-amd64": "StashHybridRecommendationsEngineLinuxAmd64",
    "linux-arm64v8": "StashHybridRecommendationsEngineLinuxArm64v8",
    "linux-arm32v7": "StashHybridRecommendationsEngineLinuxArm32v7",
    "linux-arm32v6": "StashHybridRecommendationsEngineLinuxArm32v6",
    "macos-arm64": "StashHybridRecommendationsEngineMacosArm64",
    "macos-amd64": "StashHybridRecommendationsEngineMacosAmd64",
    "windows-amd64": "StashHybridRecommendationsEngineWindowsAmd64",
    "windows-arm64": "StashHybridRecommendationsEngineWindowsArm64",
    "freebsd-amd64": "StashHybridRecommendationsEngineFreebsdAmd64",
    "freebsd-arm64": "StashHybridRecommendationsEngineFreebsdArm64",
  };

  const markerWallQuery = `
    query ClipsMarkerWall($q: String) {
      markerWall(q: $q) {
        id
        title
        seconds
        end_seconds
        stream
        preview
        screenshot
        primary_tag {
          id
          name
        }
        scene {
          id
          title
          files {
            basename
            path
          }
        }
      }
    }
  `;

  const sceneMarkersQuery = `
    query ClipsSceneMarkers($id: ID!) {
      findScene(id: $id) {
        id
        title
        scene_markers {
          id
          title
          seconds
          end_seconds
          stream
          preview
          screenshot
          primary_tag {
            id
            name
          }
          scene {
            id
            title
            files {
              basename
              path
            }
          }
        }
      }
    }
  `;

  const hybridRecommendMutation = `
    mutation ClipsHybridRecommendations($plugin_id: ID!, $args: Map) {
      runPluginOperation(plugin_id: $plugin_id, args: $args)
    }
  `;

  const hybridPluginsQuery = `
    query ClipsHybridPlugins {
      plugins {
        id
        enabled
      }
    }
  `;

  const clipsSettingsQuery = `
    query ClipsSettings {
      configuration {
        plugins
      }
    }
  `;

  function graphql(query, variables) {
    return fetch("/graphql", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    })
      .then((response) => response.json())
      .then((payload) => {
        if (payload.errors && payload.errors.length) {
          throw new Error(payload.errors.map((error) => error.message).join("; "));
        }

        return payload.data;
      });
  }

  function absolutizePath(path) {
    if (!path) {
      return "";
    }

    if (/^https?:\/\//i.test(path) || path.startsWith("/")) {
      return path;
    }

    return `/${path}`;
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function markerLabel(marker) {
    const tag = marker.primary_tag && marker.primary_tag.name;
    return marker.title || tag || "Marker";
  }

  function sceneLabel(marker) {
    const scene = marker.scene || {};
    if (scene.title) {
      return scene.title;
    }

    const file = Array.isArray(scene.files) && scene.files.length ? scene.files[0] : null;
    if (file && file.basename) {
      return file.basename;
    }

    if (file && file.path) {
      const parts = String(file.path).split(/[\\/]/);
      return parts[parts.length - 1] || "Untitled scene";
    }

    return "Untitled scene";
  }

  function scenePath(marker) {
    const sceneId = marker.scene && marker.scene.id;
    return sceneId ? `/scenes/${encodeURIComponent(sceneId)}` : "";
  }

  function formatScore(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) {
      return "";
    }

    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  }

  function isRenderableReactNode(value) {
    if (value == null || typeof value === "boolean") {
      return true;
    }

    if (typeof value === "string" || typeof value === "number") {
      return true;
    }

    if (Array.isArray(value)) {
      return value.every(isRenderableReactNode);
    }

    if (React.isValidElement && React.isValidElement(value)) {
      return true;
    }

    return Boolean(value && value.$$typeof === Symbol.for("react.element"));
  }

  function patchResultOrNull(result) {
    return isRenderableReactNode(result) ? result : null;
  }

  function shuffled(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  function getStoredHybridEnginePluginId() {
    const core = window.StashHybridRecommendationsCore;
    if (core && core.readSetting && core.getEngineTarget) {
      const target = core.getEngineTarget(core.readSetting("engineTarget", core.DEFAULT_ENGINE_TARGET));
      return target && target.enginePluginId;
    }

    let target = "linux-arm64v8";
    try {
      target = window.localStorage.getItem(hybridStoragePrefix + "engineTarget") || target;
    } catch (_) {}

    return hybridEngineTargets[target] || null;
  }

  function normalizeRecommendationSource(value) {
    return value === "hybrid" ? "hybrid" : "random";
  }

  function normalizeClipsSettings(settings) {
    const source = settings && typeof settings === "object" ? settings : {};
    return {
      recommendationSource: normalizeRecommendationSource(
        source[recommendationSourceSetting] || defaultClipsSettings.recommendationSource
      ),
      unmuteOnEnter:
        typeof source[unmuteOnEnterSetting] === "boolean"
          ? source[unmuteOnEnterSetting]
          : defaultClipsSettings.unmuteOnEnter,
    };
  }

  function getPluginSettings(settingsById) {
    const source = settingsById && typeof settingsById === "object" ? settingsById : {};
    for (const id of pluginSettingIds) {
      if (source[id]) {
        return source[id];
      }
    }

    return {};
  }

  function loadClipsSettings() {
    return graphql(clipsSettingsQuery, {})
      .then((data) => {
        const plugins = data.configuration && data.configuration.plugins;
        return normalizeClipsSettings(getPluginSettings(plugins));
      })
      .catch(() => defaultClipsSettings);
  }

  function readRecommendationSource() {
    try {
      return normalizeRecommendationSource(
        window.localStorage.getItem(clipsStoragePrefix + recommendationSourceSetting)
      );
    } catch (_) {
      return "random";
    }
  }

  function writeRecommendationSource(value) {
    try {
      window.localStorage.setItem(
        clipsStoragePrefix + recommendationSourceSetting,
        normalizeRecommendationSource(value)
      );
    } catch (_) {}
  }

  function loadHybridEnginePluginId() {
    const storedPluginId = getStoredHybridEnginePluginId();
    const knownPluginIds = new Set(Object.values(hybridEngineTargets));

    return graphql(hybridPluginsQuery, {}).then((data) => {
      const plugins = Array.isArray(data.plugins) ? data.plugins : [];
      const storedPlugin = plugins.find((plugin) => plugin.id === storedPluginId);
      if (storedPlugin && storedPlugin.enabled) {
        return storedPlugin.id;
      }

      const enabledEngine = plugins.find((plugin) => knownPluginIds.has(plugin.id) && plugin.enabled);
      if (enabledEngine) {
        return enabledEngine.id;
      }

      const installedEngine = plugins.find((plugin) => knownPluginIds.has(plugin.id));
      if (installedEngine) {
        return installedEngine.id;
      }

      return null;
    });
  }

  function parseHybridOperationOutput(value) {
    if (value == null) {
      return {};
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return {};
      }

      try {
        return JSON.parse(trimmed);
      } catch (_) {
        return {};
      }
    }

    if (typeof value === "object") {
      if (typeof value.Output === "string") {
        return parseHybridOperationOutput(value.Output);
      }

      if (typeof value.output === "string") {
        return parseHybridOperationOutput(value.output);
      }

      return value;
    }

    return {};
  }

  function pickFreshMarker(markers, history) {
    const playable = markers.filter((marker) => Boolean(marker.stream));
    if (!playable.length) {
      return null;
    }

    const recentIds = new Set(history.slice(-12).map((marker) => marker.id));
    const fresh = playable.filter((marker) => !recentIds.has(marker.id));
    const pool = fresh.length ? fresh : playable;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function loadRandomMarker(history) {
    return graphql(markerWallQuery, { q: null }).then((data) => {
      const marker = pickFreshMarker(data.markerWall || [], history);
      if (!marker) {
        throw new Error("No playable marker streams were returned by Stash.");
      }

      return marker;
    });
  }

  function loadMarkersForScene(sceneId) {
    return graphql(sceneMarkersQuery, { id: sceneId }).then((data) => {
      return data.findScene && Array.isArray(data.findScene.scene_markers)
        ? data.findScene.scene_markers
        : [];
    });
  }

  function loadHybridRecommendedMarker(sourceSceneId, history) {
    if (!sourceSceneId) {
      return Promise.reject(new Error("Hybrid Recommendations is not available."));
    }

    return loadHybridEnginePluginId()
      .then((pluginId) => {
        if (!pluginId) {
          throw new Error("Hybrid Recommendations engine is not installed.");
        }

        return graphql(hybridRecommendMutation, {
          plugin_id: pluginId,
          args: {
            mode: "recommend",
            sceneId: String(sourceSceneId),
            limit: recommendationLimit,
          },
        });
      })
      .then((data) => {
        const parsed = parseHybridOperationOutput(data.runPluginOperation);
        const recommendations = Array.isArray(parsed.recommendations)
          ? parsed.recommendations
          : [];
        const sourceIds = recommendations
          .map((rec) => String((rec && (rec.sceneId || (rec.scene && rec.scene.id))) || ""))
          .filter(Boolean);
        const recommendationBySceneId = recommendations.reduce((map, rec) => {
          const sceneId = String((rec && (rec.sceneId || (rec.scene && rec.scene.id))) || "");
          if (sceneId) {
            map[sceneId] = rec;
          }
          return map;
        }, {});

        if (!sourceIds.length) {
          throw new Error("Hybrid Recommendations returned no scenes.");
        }

        const recentSceneIds = new Set(
          history.slice(-10).map((marker) => marker.scene && marker.scene.id).filter(Boolean)
        );
        const orderedSceneIds = sourceIds
          .filter((id) => !recentSceneIds.has(id))
          .concat(sourceIds.filter((id) => recentSceneIds.has(id)));

        return orderedSceneIds.reduce((promise, sceneId) => {
          return promise.catch(() =>
            loadMarkersForScene(sceneId).then((markers) => {
              const marker = pickFreshMarker(shuffled(markers), history);
              if (!marker) {
                throw new Error("Recommended scene has no playable markers.");
              }

              const recommendation = recommendationBySceneId[sceneId] || {};
              return Object.assign({}, marker, {
                clipsRecommendation: {
                  source: "hybrid",
                  score: recommendation.score,
                },
              });
            })
          );
        }, Promise.reject(new Error("No recommended marker found.")));
      });
  }

  function ClipsPage() {
    const [history, setHistory] = React.useState([]);
    const [index, setIndex] = React.useState(-1);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState("");
    const [clipsSettings, setClipsSettings] = React.useState(defaultClipsSettings);
    const [muted, setMuted] = React.useState(!defaultClipsSettings.unmuteOnEnter);
    const [paused, setPaused] = React.useState(false);
    const [videoFailed, setVideoFailed] = React.useState(false);
    const touchStartY = React.useRef(null);
    const wheelLock = React.useRef(false);
    const loadingRef = React.useRef(false);
    const videoRef = React.useRef(null);

    const current = history[index] || null;

    React.useEffect(() => {
      let canceled = false;
      loadClipsSettings().then((settings) => {
        if (canceled) {
          return;
        }

        setClipsSettings(settings);
        setMuted(!settings.unmuteOnEnter);
      });

      return () => {
        canceled = true;
      };
    }, []);

    const loadNext = React.useCallback(() => {
      if (loadingRef.current) {
        return;
      }

      if (index >= 0 && index < history.length - 1) {
        setIndex((value) => value + 1);
        return;
      }

      loadingRef.current = true;
      setLoading(true);
      setError("");

      const sourceSceneId = current && current.scene && current.scene.id;
      const recommendationSource = clipsSettings.recommendationSource;
      const markerPromise = recommendationSource === "hybrid" && sourceSceneId
        ? loadHybridRecommendedMarker(sourceSceneId, history).catch(() => loadRandomMarker(history))
        : loadRandomMarker(history);

      markerPromise
        .then((marker) => {
          setHistory((value) => {
            const next = value.concat(marker).slice(-maxHistory);
            setIndex(next.length - 1);
            return next;
          });
        })
        .catch((err) => {
          setError(err.message || "Unable to load a marker preview.");
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
        });
    }, [clipsSettings.recommendationSource, current, history, index]);

    const loadPrevious = React.useCallback(() => {
      setIndex((value) => Math.max(0, value - 1));
    }, []);

    React.useEffect(() => {
      if (index === -1 && !history.length) {
        loadNext();
      }
    }, [history.length, index, loadNext]);

    React.useEffect(() => {
      setVideoFailed(false);
      setPaused(false);
      if (videoRef.current) {
        videoRef.current.muted = muted;
        videoRef.current.load();
        videoRef.current.play().catch(() => {});
      }
    }, [current && current.id]);

    React.useEffect(() => {
      if (videoRef.current) {
        videoRef.current.muted = muted;
      }
    }, [muted]);

    function toggleMuted() {
      setMuted((value) => {
        const next = !value;
        if (videoRef.current) {
          videoRef.current.muted = next;
          videoRef.current.volume = 1;
        }
        return next;
      });
    }

    function togglePaused() {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      if (video.paused) {
        video.play().then(() => setPaused(false)).catch(() => {});
      } else {
        video.pause();
        setPaused(true);
      }
    }

    const onWheel = React.useCallback(
      (event) => {
        event.preventDefault();

        if (wheelLock.current || Math.abs(event.deltaY) < wheelThreshold) {
          return;
        }

        wheelLock.current = true;
        window.setTimeout(() => {
          wheelLock.current = false;
        }, 520);

        if (event.deltaY > 0) {
          loadNext();
        } else {
          loadPrevious();
        }
      },
      [loadNext, loadPrevious]
    );

    const onTouchStart = React.useCallback((event) => {
      touchStartY.current = event.touches[0].clientY;
    }, []);

    const onTouchEnd = React.useCallback(
      (event) => {
        if (touchStartY.current === null) {
          return;
        }

        const delta = touchStartY.current - event.changedTouches[0].clientY;
        touchStartY.current = null;

        if (Math.abs(delta) < swipeThreshold) {
          return;
        }

        if (delta > 0) {
          loadNext();
        } else {
          loadPrevious();
        }
      },
      [loadNext, loadPrevious]
    );

    const meta = current
      ? [
          current.primary_tag && current.primary_tag.name,
          formatTime(current.seconds),
          current.end_seconds ? `${Math.round(current.end_seconds - current.seconds)}s` : "",
        ]
          .filter(Boolean)
          .join(" / ")
      : "";
    const fallbackImage = current && absolutizePath(current.screenshot || current.preview);
    const currentScenePath = current ? scenePath(current) : "";
    const recommendationScore =
      current && current.clipsRecommendation && current.clipsRecommendation.source === "hybrid"
        ? formatScore(current.clipsRecommendation.score)
        : "";

    return React.createElement(
      "div",
      {
        className: "clips-feed-shell",
        onWheel,
        onTouchStart,
        onTouchEnd,
      },
      React.createElement(
        "div",
        { className: "clips-feed-stage" },
        current &&
          !videoFailed &&
          React.createElement("video", {
            ref: videoRef,
            className: "clips-feed-video",
            src: absolutizePath(current.stream),
            poster: fallbackImage,
            autoPlay: true,
            loop: true,
            muted,
            playsInline: true,
            controls: false,
            onClick: togglePaused,
            onPlay: () => setPaused(false),
            onPause: () => setPaused(true),
            onError: () => setVideoFailed(true),
          }),
        current &&
          !videoFailed &&
          paused &&
          React.createElement("div", {
            className: "clips-feed-play-indicator",
            "aria-hidden": "true",
          }, React.createElement(api.components.Icon, { icon: faPlay })),
        current &&
          videoFailed &&
          fallbackImage &&
          React.createElement("img", {
            className: "clips-feed-video",
            src: fallbackImage,
            alt: "",
          }),
        current &&
          React.createElement(
            "div",
            { className: "clips-feed-overlay" },
            React.createElement("h1", { className: "clips-feed-title" }, markerLabel(current)),
            currentScenePath &&
              React.createElement(
                NavLink,
                {
                  className: "clips-feed-scene-link",
                  to: currentScenePath,
                  onClick: (event) => event.stopPropagation(),
                },
                sceneLabel(current),
                recommendationScore &&
                  React.createElement(
                    "span",
                    { className: "clips-feed-score" },
                    ` - score: ${recommendationScore}`
                  )
              ),
            React.createElement("p", { className: "clips-feed-meta" }, meta)
          ),
        React.createElement(
          "div",
          { className: "clips-feed-actions" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "clips-feed-action",
              title: muted ? "Enable audio" : "Mute audio",
              onClick: toggleMuted,
            },
            React.createElement(api.components.Icon, {
              icon: muted ? faVolumeMute : faVolumeUp,
            })
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "clips-feed-action",
              disabled: index <= 0,
              title: "Previous",
              onClick: loadPrevious,
            },
            React.createElement(api.components.Icon, { icon: faArrowUp })
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "clips-feed-action",
              disabled: loading,
              title: "Next",
              onClick: loadNext,
            },
            React.createElement(api.components.Icon, { icon: faArrowDown })
          )
        ),
        loading &&
          React.createElement(
            "div",
            { className: "clips-feed-state" },
            React.createElement("div", { className: "clips-feed-spinner" })
          ),
        error &&
          React.createElement(
            "div",
            { className: "clips-feed-state" },
            React.createElement("p", null, error)
          )
      )
    );
  }

  api.register.route(routePath, ClipsPage);

  function ClipsSettingsPanel() {
    const settings = useSettings();
    const pluginSettings = getPluginSettings(settings.plugins);
    const pluginSettingsId = pluginSettingIds.find(
      (id) => settings.plugins && settings.plugins[id]
    ) || pluginId;
    const recommendationSource = normalizeRecommendationSource(
      pluginSettings[recommendationSourceSetting] || readRecommendationSource()
    );
    const [hybridAvailable, setHybridAvailable] = React.useState(false);

    React.useEffect(() => {
      writeRecommendationSource(recommendationSource);
    }, [recommendationSource]);

    React.useEffect(() => {
      let canceled = false;
      loadHybridEnginePluginId()
        .then((enginePluginId) => {
          if (!canceled) {
            setHybridAvailable(Boolean(enginePluginId));
          }
        })
        .catch(() => {
          if (!canceled) {
            setHybridAvailable(false);
          }
        });

      return () => {
        canceled = true;
      };
    }, []);

    function saveRecommendationSource(value) {
      const nextValue = normalizeRecommendationSource(value);
      writeRecommendationSource(nextValue);
      settings.savePluginSettings(pluginSettingsId, {
        ...pluginSettings,
        [recommendationSourceSetting]: nextValue,
      });
    }

    return React.createElement(
      "div",
      { className: "clips-settings-panel" },
      React.createElement(
          "div",
          { className: "setting" },
          React.createElement(
            "div",
            null,
            React.createElement("h3", null, "Recommendation source"),
            React.createElement(
              "div",
              { className: "sub-heading" },
              "Choose how the next clip is selected. Random is the default."
            )
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "select",
              {
                className: "form-control input-control clips-settings-source",
                value: recommendationSource,
                onChange: (event) => saveRecommendationSource(event.currentTarget.value),
              },
              React.createElement("option", { value: "random" }, "Random"),
              React.createElement(
                "option",
                { value: "hybrid", disabled: !hybridAvailable },
                hybridAvailable ? "Hybrid Recommendations" : "Hybrid Recommendations (not detected)"
              )
            )
          )
        )
    );
  }

  api.patch.after("PluginSettings", function () {
    const args = Array.prototype.slice.call(arguments);
    const props = args[0];
    const result = args[args.length - 1];

    if (!props || props.pluginID !== pluginId) {
      return result;
    }

    return React.createElement(
      React.Fragment,
      null,
      patchResultOrNull(result),
      React.createElement(ClipsSettingsPanel, null)
    );
  });

  api.patch.before("MainNavBar.MenuItems", function (props) {
    return [
      {
        children: React.createElement(
          React.Fragment,
          null,
          props.children,
          React.createElement(
            Nav.Link,
            {
              as: "div",
              key: "clips-feed-nav",
              className: "col-4 col-sm-3 col-md-2 col-lg-auto",
            },
            React.createElement(
              NavLink,
              {
                exact: true,
                to: routePath,
                className:
                  "btn minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center",
                activeClassName: "active",
              },
              React.createElement(api.components.Icon, {
                icon: faPlayCircle,
                className: "nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0",
              }),
              React.createElement("span", null, "Clips")
            )
          )
        ),
      },
    ];
  });
})();
