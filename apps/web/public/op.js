(function initializeShortOpPage(globalObject) {
  function isValidShortCode(value) {
    return /^[1-9][0-9]{8}$/.test(String(value || ""));
  }

  function extractShortCode(locationLike) {
    var pathname = String((locationLike && locationLike.pathname) || "");
    var match = pathname.match(/^\/(?:op\/)?([1-9][0-9]{8})\/?$/);
    return match ? match[1] : "";
  }

  function readErrorMessage(payload, fallback) {
    if (payload && typeof payload === "object" && typeof payload.error === "string" && payload.error) {
      return payload.error;
    }
    return fallback || "短码解析失败";
  }

  function createAppHandoff(options) {
    var appName = options.appName || "抖音";
    var url = options.url;
    var message = options.message;
    var submitButton = options.submitButton;
    var locationLike = options.locationLike;
    var setTimeoutImpl = options.setTimeoutImpl || setTimeout;
    var clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
    var navigationTimer;
    var fallbackTimer;

    function restore() {
      clearTimeoutImpl(navigationTimer);
      clearTimeoutImpl(fallbackTimer);
      submitButton.disabled = false;
      message.textContent = "未能自动打开" + appName + "，请确认已安装后重试";
      message.className = "message error";
    }

    message.textContent = "正在打开" + appName + "…";
    message.className = "message success";
    navigationTimer = setTimeoutImpl(function () {
      try {
        locationLike.href = url;
      } catch (error) {
        restore();
      }
    }, 50);
    fallbackTimer = setTimeoutImpl(restore, 1500);

    return { restore: restore };
  }

  var api = {
    createAppHandoff: createAppHandoff,
    extractShortCode: extractShortCode,
    isValidShortCode: isValidShortCode,
    readErrorMessage: readErrorMessage
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (!globalObject || !globalObject.document) {
    return;
  }

  var documentRef = globalObject.document;
  documentRef.addEventListener("DOMContentLoaded", function () {
    var form = documentRef.querySelector("#short-op-form");
    var input = documentRef.querySelector("#short-code");
    var submitButton = documentRef.querySelector("#submit-short-code");
    var message = documentRef.querySelector("#short-op-message");
    if (!form || !input || !submitButton || !message) {
      return;
    }

    var activeHandoff = null;

    globalObject.addEventListener("pageshow", function () {
      if (activeHandoff) {
        activeHandoff.restore();
        activeHandoff = null;
      } else {
        submitButton.disabled = false;
      }
    });

    var pathCode = extractShortCode(globalObject.location);
    if (pathCode) {
      input.value = pathCode;
    }

    input.addEventListener("input", function () {
      input.value = String(input.value || "").replace(/\D/g, "").slice(0, 9);
      message.textContent = "";
      message.className = "message";
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var code = String(input.value || "");
      if (!isValidShortCode(code)) {
        message.textContent = "请输入正确的 9 位短码";
        message.className = "message error";
        return;
      }

      submitButton.disabled = true;
      message.textContent = "正在解析短码…";
      message.className = "message";

      globalObject
        .fetch("/api/op/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "omit",
          cache: "no-store",
          body: JSON.stringify({ code: code })
        })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (result) {
              if (!response.ok) {
                throw new Error(readErrorMessage(result, "短码解析失败"));
              }
              if (!result || !result.wakeUrl) {
                throw new Error("短码解析失败");
              }
              return result;
            });
        })
        .then(function (result) {
          var appName =
            result.project && result.project.name ? result.project.name : "抖音";
          activeHandoff = createAppHandoff({
            appName: appName,
            url: result.wakeUrl,
            message: message,
            submitButton: submitButton,
            locationLike: globalObject.location
          });
        })
        .catch(function (error) {
          message.textContent =
            (error && error.message) || "网络异常，请检查网络后重试";
          message.className = "message error";
          submitButton.disabled = false;
        });
    });
  });
}(typeof window === "undefined" ? undefined : window));
