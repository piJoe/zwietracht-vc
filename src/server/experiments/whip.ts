import express from "express";
import sdpTransform from "sdp-transform";
import sdpCommonUtils from "mediasoup-client/lib/handlers/sdp/commonUtils";
import ortc from "mediasoup-client/lib/ortc";
import { RemoteSdp } from "mediasoup-client/lib/handlers/sdp/RemoteSdp";
import sdpUnifiedPlanUtils from "mediasoup-client/lib/handlers/sdp/unifiedPlanUtils";
import utils from "mediasoup-client/lib/utils";

export async function setupWHIP() {
  const app = express();
  const port = 3000;
  app.use(
    express.text({
      type: [
        "application/sdp",
        "application/trickle-ice-sdpfrag",
        "text/plain",
      ],
    })
  );
  app.listen(port);

  app.post("/whip/:broadcasterId", async (req, res) => {
    const { broadcasterId } = req.params;

    try {
      const localSdpObject = sdpTransform.parse(req.body);

      const rtpCapabilities = sdpCommonUtils.extractRtpCapabilities({
        sdpObject: localSdpObject,
      });
      const dtlsParameters = sdpCommonUtils.extractDtlsParameters({
        sdpObject: localSdpObject,
      });

      const routerRtpCapabilities = router.rtpCapabilities;
      const extendedRtpCapabilities = ortc.getExtendedRtpCapabilities(
        rtpCapabilities,
        routerRtpCapabilities
      );

      const sendingRtpParametersByKind = {
        audio: ortc.getSendingRtpParameters("audio", extendedRtpCapabilities),
        video: ortc.getSendingRtpParameters("video", extendedRtpCapabilities),
      };
      const sendingRemoteRtpParametersByKind = {
        audio: ortc.getSendingRemoteRtpParameters(
          "audio",
          extendedRtpCapabilities
        ),
        video: ortc.getSendingRemoteRtpParameters(
          "video",
          extendedRtpCapabilities
        ),
      };

      // Create a WebRTC transport.
      const transport = await router.createWebRtcTransport({
        listenInfos: listenInfos,
      });

      // Connect the WebRTC transport.
      await transport.connect({ dtlsParameters });

      const remoteSdp = new RemoteSdp({
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        sctpParameters: transport.sctpParameters,
      });

      // Publish audio and video.
      for (const { type, mid } of localSdpObject.media) {
        console.log("trying to publish", type, mid);
        const mediaSectionIdx = remoteSdp.getNextMediaSectionIdx();
        const offerMediaObject = localSdpObject.media[mediaSectionIdx.idx];

        const sendingRtpParameters = utils.clone(
          sendingRtpParametersByKind[type],
          {}
        );

        const sendingRemoteRtpParameters = utils.clone(
          sendingRemoteRtpParametersByKind[type],
          {}
        );

        // Set MID.
        sendingRtpParameters.mid = String(mid);

        // Set RTCP CNAME.
        sendingRtpParameters.rtcp.cname = sdpCommonUtils.getCname({
          offerMediaObject,
        });

        // Set RTP encodings by parsing the SDP offer.
        sendingRtpParameters.encodings = sdpUnifiedPlanUtils.getRtpEncodings({
          offerMediaObject,
        });

        console.log(
          "sending remote sdp",
          sendingRtpParameters,
          sendingRemoteRtpParameters
        );

        remoteSdp.send({
          offerMediaObject,
          reuseMid: mediaSectionIdx.reuseMid,
          offerRtpParameters: sendingRtpParameters,
          answerRtpParameters: sendingRemoteRtpParameters,
          codecOptions: {},
          extmapAllowMixed: true,
        });

        // start producing
        const producer = await transport.produce({
          kind: type,
          rtpParameters: sendingRtpParameters,
        });
        producer.appData.remoteSdp = remoteSdp;
        producer.appData.transport = transport;
        userIdProducerMap.set(`${broadcasterId}-${type}`, producer);
        console.log("started producer", `${broadcasterId}-${type}`);
      }
      const answer = remoteSdp.getSdp();

      res.setHeader(
        "Location",
        `https://192.168.88.254:3000/whip/${req.params.broadcasterId}`
      );
      res.contentType("application/sdp").status(201).send(answer);
    } catch (error) {
      console.error(error);
    }
  });

  app.patch("/whip/:broadcasterId", async (req, res) => {
    console.log("whip PATCH", req.params, req.headers, req.body);
    const { broadcasterId } = req.params;

    try {
      const producer = userIdProducerMap.get(`${broadcasterId}-audio`);

      if (!producer)
        throw Error(`broadcaster with id "${broadcasterId}" does not exist`);

      const { transport, remoteSdp } = producer.appData;

      if (!remoteSdp)
        throw Error(
          `broadcaster with id "${broadcasterId}" has no remote SDP set`
        );

      const iceParameters = await transport.restartIce();
      remoteSdp.updateIceParameters(iceParameters);

      const answer = remoteSdp.getSdp();

      res.contentType("application/sdp").status(200).send(answer);
    } catch (error) {
      console.error(error);
    }
  });
}
