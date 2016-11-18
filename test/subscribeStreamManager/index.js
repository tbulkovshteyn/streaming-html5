(function(window, document, red5pro) {
  'use strict';

  var configuration = (function () {
    var conf = sessionStorage.getItem('r5proTestBed');
    try {
      return JSON.parse(conf);
    }
    catch (e) {
      console.error('Could not read testbed configuration from sessionstorage: ' + e.message);
    }
    return {}
  })();

  red5pro.setLogLevel(configuration.verboseLogging ? red5pro.LogLevels.TRACE : red5pro.LogLevels.WARN);

  var targetSubscriber;
  var targetView;

  var updateStatusFromEvent = function (event) {
    var subTypes = red5pro.SubscriberEventTypes;
    switch (event.type) {
        case subTypes.CONNECT_FAILURE:
        case subTypes.SUBSCRIBE_FAIL:
          shutdownVideoElement();
          break;
    }
    window.red5proHandleSubscriberEvent(event); // defined in src/template/partial/status-field-subscriber.hbs
  };
  var streamTitle = document.getElementById('stream-title');
  var protocol = window.location.protocol;
  protocol = protocol.substring(0, protocol.lastIndexOf(':'));
  function getSocketLocationFromProtocol (protocol) {
    return protocol === 'http' ? {protocol: 'ws', port: 8081} : {protocol: 'wss', port: 8083};
  }

  var defaultConfiguration = {
    protocol: getSocketLocationFromProtocol(protocol).protocol,
    port: getSocketLocationFromProtocol(protocol).port,
    app: 'live',
    bandwidth: {
      audio: 50,
      video: 256,
      data: 30 * 1000 * 1000
    }
  }

  function shutdownVideoElement () {
    var videoElement = document.getElementById('red5pro-subscriber-video');
    if (videoElement) {
      videoElement.pause()
      videoElement.src = ''
    }
  }

  // Local lifecycle notifications.
  function onSubscriberEvent (event) {
    console.log('[Red5ProSubsriber] ' + event.type + '.');
    updateStatusFromEvent(event);
  }
  function onSubscribeFail (message) {
    console.error('[Red5ProSubsriber] Subscribe Error :: ' + message);
  }
  function onSubscribeSuccess () {
    console.log('[Red5ProSubsriber] Subscribe Complete.');
  }
  function onUnsubscribeFail (message) {
    console.error('[Red5ProSubsriber] Unsubscribe Error :: ' + message);
  }
  function onUnsubscribeSuccess () {
    console.log('[Red5ProSubsriber] Unsubscribe Complete.');
  }

  function requestEdge (configuration) {
    var host = configuration.host;
    var app = configuration.app;
    var streamName = configuration.stream1;
    var protocol = window.location.protocol || 'https:';
    var baseurl = protocol === 'https:' ? protocol + '//' + host : protocol + '//' + host + ':5080';
    var url = baseurl + '/streammanager/api/1.0/event/' + app + '/' + streamName + '?action=subscribe';
      return new Promise(function (resolve, reject) {
        fetch(url)
          .then(function (res) {
            if (res.headers.get("content-type") &&
              res.headers.get("content-type").toLowerCase().indexOf("application/json") >= 0) {
                return res.json();
            }
            else {
              throw new TypeError('Could not properly parse response.');
            }
          })
          .then(function (json) {
            resolve(json.serverAddress);
          })
          .catch(function (error) {
            var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2)
            console.error('[SubscribeStreamManagerTest] :: Error - Could not request Edge IP from Stream Manager. ' + jsonError)
            reject(error)
          });
    });
  }

  // Request to start subscribing using an overlayed configuration from local default and local storage.
  function subscribe (host) {
    var config = Object.assign({}, configuration, defaultConfiguration);
    config.host = host;
    config.streamName = config.stream1;
    console.log('[Red5ProSubscriber] config:: ' + JSON.stringify(config, null, 2));

    // Setup view.
    var view = new red5pro.PlaybackView('red5pro-subscriber-video');
    var subscriber = new red5pro.RTCSubscriber();
    var origAttachStream = view.attachStream.bind(view);
    view.attachStream = function (stream, autoplay) {
      origAttachStream(stream, autoplay)
      view.attachStream = origAttachStream
    };
    view.attachSubscriber(subscriber);
    streamTitle.innerText = config.streamName;

    targetSubscriber = subscriber;
    targetView = view;

    // Subscribe to events.
    subscriber.on('*', onSubscriberEvent);
    // Initiate playback.
    subscriber.init(config)
      .then(function (player) {
        return player.play();
      })
      .then(function () {
        onSubscribeSuccess()
      })
      .catch(function (error) {
        var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2)
        onSubscribeFail('Error - ' + jsonError);
      });
  }

  // Request to unsubscribe.
  function unsubscribe () {
    return new Promise(function(resolve, reject) {
      var view = targetView
      var subscriber = targetSubscriber
      if (subscriber) {
        subscriber.stop()
          .then(function () {
            view.view.src = ''
            subscriber.setView(undefined)
            subscriber.off('*', onSubscriberEvent);
            onUnsubscribeSuccess();
            resolve();
          })
          .catch(function (error) {
            var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
            onUnsubscribeFail('Unmount Error = ' + jsonError);
            reject('Could not unsubscribe: ' + error);
          });
      }
      else {
        resolve()
      }
    });
  }

  // Kick off.
  requestEdge(configuration)
    .then(subscribe)
    .catch(function (error) {
      onSubscribeFail(error);
      console.error('Could not subscriber with Edge IP: ' + error);
    });

  // Clean up.
  window.addEventListener('beforeunload', function() {
    function clearRefs () {
      targetSubscriber.off('*', onSubscriberEvent);
      targetSubscriber = targetView = undefined;
    }
    unsubscribe().then(clearRefs).catch(clearRefs);
  });

})(this, document, window.red5prosdk);