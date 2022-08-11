var WebRtcStreamer = (function() {

/**
 * Interface with WebRTC-streamer API
 * @constructor
 * @param {string} videoElement - id of the video element tag
 * @param {string} srvurl -  url of webrtc-streamer (default is current location)
*/
var WebRtcStreamer = function WebRtcStreamer (videoElement, srvurl) {
    if (typeof videoElement === "string") {
        this.videoElement = document.getElementById(videoElement);
    } else {
        this.videoElement = videoElement;
    }
    this.srvurl           = srvurl || location.protocol+"//"+window.location.hostname+":"+window.location.port;
    this.pc               = null;

    this.mediaConstraints = { offerToReceiveAudio: true, offerToReceiveVideo: true };

    this.iceServers = null;
    this.earlyCandidates = [];
}

WebRtcStreamer.prototype._handleHttpErrors = function (response) {
    if (!response.ok) {
        throw Error(response.statusText);
    }
    return response;
}

/**
 * Connect a WebRTC Stream to videoElement
 * @param {string} videourl - id of WebRTC video stream
 * @param {string} audiourl - id of WebRTC audio stream
 * @param {string} options -  options of WebRTC call
 * @param {string} stream  -  local stream to send
*/
WebRtcStreamer.prototype.connect = function(videourl, audiourl, options, localstream) {
    this.disconnect();

    // getIceServers is not already received
    if (!this.iceServers) {
        console.log("Get IceServers");

        fetch(this.srvurl + "/api/getIceServers")
            .then(this._handleHttpErrors)
            .then( (response) => (response.json()) )
            .then( (response) =>  this.onReceiveGetIceServers(response, videourl, audiourl, options, localstream))
            .catch( (error) => this.onError("getIceServers " + error ))

    } else {
        this.onReceiveGetIceServers(this.iceServers, videourl, audiourl, options, localstream);
    }
}

/**
 * Disconnect a WebRTC Stream and clear videoElement source
*/
WebRtcStreamer.prototype.disconnect = function() {
    if (this.videoElement?.srcObject) {
        this.videoElement.srcObject.getTracks().forEach(track => {
            track.stop()
            this.videoElement.srcObject.removeTrack(track);
        });
    }
    if (this.pc) {
        fetch(this.srvurl + "/api/hangup?peerid=" + this.pc.peerid)
            .then(this._handleHttpErrors)
            .catch( (error) => this.onError("hangup " + error ))


        try {
            this.pc.close();
        }
        catch (e) {
            console.log ("Failure close peer connection:" + e);
        }
        this.pc = null;
    }
}

/*
* GetIceServers callback
*/
WebRtcStreamer.prototype.onReceiveGetIceServers = function(iceServers, videourl, audiourl, options, stream) {
    this.iceServers       = iceServers;
    this.pcConfig         = iceServers || {"iceServers": [] };
    try {
        this.createPeerConnection();

        var callurl = this.srvurl + "/api/call?peerid=" + this.pc.peerid + "&url=" + encodeURIComponent(videourl);
        if (audiourl) {
            callurl += "&audiourl="+encodeURIComponent(audiourl);
        }
        if (options) {
            callurl += "&options="+encodeURIComponent(options);
        }

        if (stream) {
            this.pc.addStream(stream);
        }

                // clear early candidates
        this.earlyCandidates.length = 0;

        // create Offer
        this.pc.createOffer(this.mediaConstraints).then((sessionDescription) => {
            console.log("Create offer:" + JSON.stringify(sessionDescription));

            this.pc.setLocalDescription(sessionDescription)
                .then(() => {
                    fetch(callurl, { method: "POST", body: JSON.stringify(sessionDescription) })
                        .then(this._handleHttpErrors)
                        .then( (response) => (response.json()) )
                        .catch( (error) => this.onError("call " + error ))
                        .then( (response) =>  this.onReceiveCall(response) )
                        .catch( (error) => this.onError("call " + error ))

                }, (error) => {
                    console.log ("setLocalDescription error:" + JSON.stringify(error));
                });

        }, (error) => {
            alert("Create offer error:" + JSON.stringify(error));
        });

    } catch (e) {
        this.disconnect();
        alert("connect error: " + e);
    }
}


WebRtcStreamer.prototype.getIceCandidate = function() {
    fetch(this.srvurl + "/api/getIceCandidate?peerid=" + this.pc.peerid)
        .then(this._handleHttpErrors)
        .then( (response) => (response.json()) )
        .then( (response) =>  this.onReceiveCandidate(response))
        .catch( (error) => this.onError("getIceCandidate " + error ))
}

/*
* create RTCPeerConnection
*/
WebRtcStreamer.prototype.createPeerConnection = function() {
    console.log("createPeerConnection  config: " + JSON.stringify(this.pcConfig));
    this.pc = new RTCPeerConnection(this.pcConfig);
    var pc = this.pc;
    pc.peerid = Math.random();

    pc.onicecandidate = (evt) => this.onIceCandidate(evt);
    pc.onaddstream    = (evt) => this.onAddStream(evt);
    pc.oniceconnectionstatechange = (evt) => {
        console.log("oniceconnectionstatechange  state: " + pc.iceConnectionState);
        if (this.videoElement) {
            if (pc.iceConnectionState === "connected") {
                this.videoElement.style.opacity = "1.0";
            }
            else if (pc.iceConnectionState === "disconnected") {
                this.videoElement.style.opacity = "0.25";
            }
            else if ( (pc.iceConnectionState === "failed") || (pc.iceConnectionState === "closed") )  {
                this.videoElement.style.opacity = "0.5";
            } else if (pc.iceConnectionState === "new") {
                this.getIceCandidate();
            }
        }
    }
    pc.ondatachannel = function(evt) {
        console.log("remote datachannel created:"+JSON.stringify(evt));

        evt.channel.onopen = function () {
            console.log("remote datachannel open");
            this.send("remote channel openned");
        }
        evt.channel.onmessage = function (event) {
            console.log("remote datachannel recv:"+JSON.stringify(event.data));
        }
    }
    pc.onicegatheringstatechange = function() {
        if (pc.iceGatheringState === "complete") {
            const recvs = pc.getReceivers();

            recvs.forEach((recv) => {
                if (recv.track && recv.track.kind === "video") {
                console.log("codecs:" + JSON.stringify(recv.getParameters().codecs))
                }
            });
            }
    }

    try {
        var dataChannel = pc.createDataChannel("ClientDataChannel");
        dataChannel.onopen = function() {
            console.log("local datachannel open");
            this.send("local channel openned");
        }
        dataChannel.onmessage = function(evt) {
            console.log("local datachannel recv:"+JSON.stringify(evt.data));
        }
    } catch (e) {
        console.log("Cannor create datachannel error: " + e);
    }

    console.log("Created RTCPeerConnnection with config: " + JSON.stringify(this.pcConfig) );
    return pc;
}


/*
* RTCPeerConnection IceCandidate callback
*/
WebRtcStreamer.prototype.onIceCandidate = function (event) {
    if (event.candidate) {
        if (this.pc.currentRemoteDescription)  {
            this.addIceCandidate(this.pc.peerid, event.candidate);
        } else {
            this.earlyCandidates.push(event.candidate);
        }
    }
    else {
        console.log("End of candidates.");
    }
}


WebRtcStreamer.prototype.addIceCandidate = function(peerid, candidate) {
    fetch(this.srvurl + "/api/addIceCandidate?peerid="+peerid, { method: "POST", body: JSON.stringify(candidate) })
        .then(this._handleHttpErrors)
        .then( (response) => (response.json()) )
        .then( (response) =>  {console.log("addIceCandidate ok:" + response)})
        .catch( (error) => this.onError("addIceCandidate " + error ))
}

/*
* RTCPeerConnection AddTrack callback
*/
WebRtcStreamer.prototype.onAddStream = function(event) {
    console.log("Remote track added:" +  JSON.stringify(event));

    this.videoElement.srcObject = event.stream;
    var promise = this.videoElement.play();
    if (promise !== undefined) {
        promise.catch((error) => {
        console.warn("error:"+error);
        this.videoElement.setAttribute("controls", true);
        });
    }
}

/*
* AJAX /call callback
*/
WebRtcStreamer.prototype.onReceiveCall = function(dataJson) {

    console.log("offer: " + JSON.stringify(dataJson));
    var descr = new RTCSessionDescription(dataJson);
    this.pc.setRemoteDescription(descr).then(() =>  {
            console.log ("setRemoteDescription ok");
            while (this.earlyCandidates.length) {
                var candidate = this.earlyCandidates.shift();
                this.addIceCandidate(this.pc.peerid, candidate);
            }

            this.getIceCandidate()
        }
        , (error) => {
            console.log ("setRemoteDescription error:" + JSON.stringify(error));
        });
}

/*
* AJAX /getIceCandidate callback
*/
WebRtcStreamer.prototype.onReceiveCandidate = function(dataJson) {
    console.log("candidate: " + JSON.stringify(dataJson));
    if (dataJson) {
        for (var i=0; i<dataJson.length; i++) {
            var candidate = new RTCIceCandidate(dataJson[i]);

            console.log("Adding ICE candidate :" + JSON.stringify(candidate) );
            this.pc.addIceCandidate(candidate).then( () =>      { console.log ("addIceCandidate OK"); }
                , (error) => { console.log ("addIceCandidate error:" + JSON.stringify(error)); } );
        }
        this.pc.addIceCandidate();
    }
};


/*
* AJAX callback for Error
*/
WebRtcStreamer.prototype.onError = function(status) {
    console.log("onError:" + status);
};

// Default function to send JSON data over data channel. Override to
// implement features such as synchronized updates over multiple windows.
WebRtcStreamer.prototype.sendJsonData = function(jsonData) {
    if (typeof this.dataChannel != 'undefined') {
        this.dataChannel.send(JSON.stringify(jsonData));
    }
};

var _getModifiers = function(event) {
    // See open3d/visualization/gui/Events.h.
    var modNone = 0;
    var modShift = 1 << 0;
    var modCtrl = 1 << 1;
    var modAlt = 1 << 2;  // Option in macOS
    var modMeta = 1 << 3;  // Command in macOS, Win in Windows, Super in Linux
    // Swap Command and Ctrl in macOS
    // if (window.navigator.platform.includes('Mac')) {
    //     [modCtrl, modMeta] = [modMeta, modCtrl];
    // }
    var mod = modNone;
    if (event.getModifierState('Shift')) {
        mod = mod | modShift;
    }
    if (event.getModifierState('Control')) {
        mod = mod | modCtrl;
    }
    if (event.getModifierState('Alt')) {
        mod = mod | modAlt;
    }
    if (event.getModifierState('Meta')) {
        mod = mod | modMeta;
    }
    return mod;
};

WebRtcStreamer.prototype.addEventListeners = function(windowUID) {
    if (this.videoElt) {
        var parentDivElt = this.videoElt.parentElement;
        var controllerDivElt = document.createElement('div');

        // TODO: Uncomment this line to display the resize controls.
        // Resize with auto-refresh still need some more work.
        // parentDivElt.insertBefore(controllerDivElt, this.videoElt);

        var heightInputElt = document.createElement('input');
        heightInputElt.id = windowUID + '_height_input';
        heightInputElt.type = 'text';
        heightInputElt.value = '';
        controllerDivElt.appendChild(heightInputElt);

        var widthInputElt = document.createElement('input');
        widthInputElt.id = windowUID + '_width_input';
        widthInputElt.type = 'text';
        widthInputElt.value = '';
        controllerDivElt.appendChild(widthInputElt);

        var resizeButtonElt = document.createElement('button');
        resizeButtonElt.id = windowUID + '_resize_button';
        resizeButtonElt.type = 'button';
        resizeButtonElt.innerText = 'Resize';
        resizeButtonElt.onclick = () => {
            var heightInputElt =
                    document.getElementById(windowUID + '_height_input');
            var widthInputElt =
                    document.getElementById(windowUID + '_width_input');
            if (!heightInputElt || !widthInputElt) {
                console.warn('Cannot resize, missing height/width inputs.');
                return;
            }
            const resizeEvent = {
                window_uid: windowUID,
                class_name: 'ResizeEvent',
                height: parseInt(heightInputElt.value),
                width: parseInt(widthInputElt.value),
            };
            this.sendJsonData(resizeEvent);
        };
        controllerDivElt.appendChild(resizeButtonElt);

        var o3dmouseButtons = ['LEFT', 'MIDDLE', 'RIGHT'];

        this.videoElt.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        }, false);
        this.videoElt.onloadedmetadata = function() {
            console.log('width is', this.videoWidth);
            console.log('height is', this.videoHeight);
            var heightInputElt =
                    document.getElementById(windowUID + '_height_input');
            if (heightInputElt) {
                heightInputElt.value = this.videoHeight;
            }
            var widthInputElt =
                    document.getElementById(windowUID + '_width_input');
            if (widthInputElt) {
                widthInputElt.value = this.videoWidth;
            }
        };

        this.videoElt.addEventListener('mousedown', (event) => {
            event.preventDefault();
            var open3dMouseEvent = {
                window_uid: windowUID,
                class_name: 'MouseEvent',
                type: 'BUTTON_DOWN',
                x: event.offsetX,
                y: event.offsetY,
                modifiers: _getModifiers(event),
                button: {
                    button: o3dmouseButtons[event.button],
                    count: 1,
                },
            };
            this.sendJsonData(open3dMouseEvent);
        }, false);
        this.videoElt.addEventListener('touchstart', (event) => {
            event.preventDefault();
            var rect = event.target.getBoundingClientRect();
            var open3dMouseEvent = {
                window_uid: windowUID,
                class_name: 'MouseEvent',
                type: 'BUTTON_DOWN',
                x: Math.round(event.targetTouches[0].pageX - rect.left),
                y: Math.round(event.targetTouches[0].pageY - rect.top),
                modifiers: 0,
                button: {
                    button: o3dmouseButtons[event.button],
                    count: 1,
                },
            };
            this.sendJsonData(open3dMouseEvent);
        }, false);
        this.videoElt.addEventListener('mouseup', (event) => {
            event.preventDefault();
            var open3dMouseEvent = {
                window_uid: windowUID,
                class_name: 'MouseEvent',
                type: 'BUTTON_UP',
                x: event.offsetX,
                y: event.offsetY,
                modifiers: _getModifiers(event),
                button: {
                    button: o3dmouseButtons[event.button],
                    count: 1,
                },
            };
            this.sendJsonData(open3dMouseEvent);
        }, false);
        this.videoElt.addEventListener('touchend', (event) => {
            event.preventDefault();
            var rect = event.target.getBoundingClientRect();
            var open3dMouseEvent = {
                window_uid: windowUID,
                class_name: 'MouseEvent',
                type: 'BUTTON_UP',
                x: Math.round(event.targetTouches[0].pageX - rect.left),
                y: Math.round(event.targetTouches[0].pageY - rect.top),
                modifiers: 0,
                button: {
                    button: o3dmouseButtons[event.button],
                    count: 1,
                },
            };
            this.sendJsonData(open3dMouseEvent);
        }, false);
        this.videoElt.addEventListener('mousemove', (event) => {
            // TODO: Known differences. Currently only left-key drag works.
            // - Open3D: L=1, M=2, R=4
            // - JavaScript: L=1, R=2, M=4
            event.preventDefault();
            var open3dMouseEvent = {
                window_uid: windowUID,
                class_name: 'MouseEvent',
                type: event.buttons === 0 ? 'MOVE' : 'DRAG',
                x: event.offsetX,
                y: event.offsetY,
                modifiers: _getModifiers(event),
                move: {
                    buttons: event.buttons,  // MouseButtons ORed together
                },
            };
            this.sendJsonData(open3dMouseEvent);
        }, false);
        this.videoElt.addEventListener('touchmove', (event) => {
            // TODO: Known differences. Currently only left-key drag works.
            // - Open3D: L=1, M=2, R=4
            // - JavaScript: L=1, R=2, M=4
            event.preventDefault();
            var rect = event.target.getBoundingClientRect();
            var open3dMouseEvent = {
                window_uid: windowUID,
                class_name: 'MouseEvent',
                type: 'DRAG',
                x: Math.round(event.targetTouches[0].pageX - rect.left),
                y: Math.round(event.targetTouches[0].pageY - rect.top),
                modifiers: 0,
                move: {
                    buttons: 1,  // MouseButtons ORed together
                },
            };
            this.sendJsonData(open3dMouseEvent);
        }, false);
        this.videoElt.addEventListener('mouseleave', (event) => {
            var open3dMouseEvent = {
                window_uid: windowUID,
                class_name: 'MouseEvent',
                type: 'BUTTON_UP',
                x: event.offsetX,
                y: event.offsetY,
                modifiers: _getModifiers(event),
                button: {
                    button: o3dmouseButtons[event.button],
                    count: 1,
                },
            };
            this.sendJsonData(open3dMouseEvent);
        }, false);
        this.videoElt.addEventListener('wheel', (event) => {
            // Prevent propagating the wheel event to the browser.
            // https://stackoverflow.com/a/23606063/1255535
            event.preventDefault();

            // https://stackoverflow.com/a/56948026/1255535.
            var isTrackpad = event.wheelDeltaY ?
                    event.wheelDeltaY === -3 * event.deltaY :
                    event.deltaMode === 0;

            // TODO: set better scaling.
            // Flip the sign and set absolute value to 1.
            var dx = event.deltaX;
            var dy = event.deltaY;
            dx = dx === 0 ? dx : (-dx / Math.abs(dx)) * 1;
            dy = dy === 0 ? dy : (-dy / Math.abs(dy)) * 1;

            var open3dMouseEvent = {
                window_uid: windowUID,
                class_name: 'MouseEvent',
                type: 'WHEEL',
                x: event.offsetX,
                y: event.offsetY,
                modifiers: _getModifiers(event),
                wheel: {
                    dx: dx,
                    dy: dy,
                    isTrackpad: isTrackpad ? 1 : 0,
                },
            };
            this.sendJsonData(open3dMouseEvent);
        }, {passive: false});
    }
};

return WebRtcStreamer;
})();

if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    window.WebRtcStreamer = WebRtcStreamer;
}
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = WebRtcStreamer;
}
