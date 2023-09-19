import sodium, { KeyPair } from "libsodium-wrappers";
import { assign, interpret, spawn } from "xstate";
import { createSyncMachine } from "./createSyncMachine";
import { generateId } from "./crypto/generateId";
import { createEphemeralMessage } from "./ephemeralMessage/createEphemeralMessage";
import { createEphemeralSession } from "./ephemeralMessage/createEphemeralSession";
import { createEphemeralMessageProof } from "./ephemeralMessage/createEphemeralSessionProof";
import { createSnapshot } from "./snapshot/createSnapshot";
import {
  EphemeralMessagePublicData,
  SnapshotPublicData,
  SnapshotUpdatesClocks,
  UpdatePublicData,
} from "./types";
import { createUpdate } from "./update/createUpdate";

const url = "wss://www.example.com";

let clientAKeyPair: KeyPair;
let clientAPublicKey: string;
let clientACounter: number;
let clientASessionId: string;
let clientAPublicData: EphemeralMessagePublicData;

let clientBKeyPair: KeyPair;
let clientBPublicKey: string;
let clientBSessionId: string;
let clientBPublicData: EphemeralMessagePublicData;

let key: Uint8Array;
let docId: string;
let snapshotId: string;

beforeEach(async () => {
  await sodium.ready;
  docId = generateId(sodium);

  clientAKeyPair = {
    privateKey: sodium.from_base64(
      "g3dtwb9XzhSzZGkxTfg11t1KEIb4D8rO7K54R6dnxArvgg_OzZ2GgREtG7F5LvNp3MS8p9vsio4r6Mq7SZDEgw"
    ),
    publicKey: sodium.from_base64(
      "74IPzs2dhoERLRuxeS7zadzEvKfb7IqOK-jKu0mQxIM"
    ),
    keyType: "ed25519",
  };
  clientAPublicKey = sodium.to_base64(clientAKeyPair.publicKey);
  clientAPublicData = {
    docId: "6e46c006-5541-11ec-bf63-0242ac130002",
    pubKey: clientAPublicKey,
  };
  clientASessionId = generateId(sodium);
  clientACounter = 0;

  clientBKeyPair = {
    privateKey: sodium.from_base64(
      "ElVI9nkbOypSu2quCTXH1i1gGlcd-Sxd7S6ym9sNZj48ben-hOmefr13D9Y1Lnys3CuhwuPb6DMh_oDln913_g"
    ),
    publicKey: sodium.from_base64(
      "PG3p_oTpnn69dw_WNS58rNwrocLj2-gzIf6A5Z_dd_4"
    ),
    keyType: "ed25519",
  };
  clientBPublicKey = sodium.to_base64(clientBKeyPair.publicKey);
  clientBSessionId = generateId(sodium);
});

type CreateSnapshotTestHelperParams = {
  parentSnapshotId: string;
  parentSnapshotCiphertext: string;
  grandParentSnapshotProof: string;
  content: string;
  parentSnapshotUpdatesClocks?: SnapshotUpdatesClocks;
};

const createSnapshotTestHelper = (params?: CreateSnapshotTestHelperParams) => {
  snapshotId = generateId(sodium);
  const {
    parentSnapshotId,
    parentSnapshotCiphertext,
    grandParentSnapshotProof,
    content,
    parentSnapshotUpdatesClocks,
  } = params || {};
  key = sodium.from_hex(
    "724b092810ec86d7e35c9d067702b31ef90bc43a7b598626749914d6a3e033ed"
  );

  const publicData: SnapshotPublicData = {
    snapshotId,
    docId: "6e46c006-5541-11ec-bf63-0242ac130002",
    pubKey: clientAPublicKey,
    parentSnapshotUpdatesClocks: parentSnapshotUpdatesClocks || {},
    parentSnapshotId: parentSnapshotId || "",
  };

  const snapshot = createSnapshot(
    content || "Hello World",
    publicData,
    key,
    clientAKeyPair,
    parentSnapshotCiphertext || "",
    grandParentSnapshotProof || "",
    sodium
  );
  return {
    snapshot: {
      ...snapshot,
      serverData: { latestVersion: 0 },
    },
    key,
    signatureKeyPair: clientAKeyPair,
  };
};

type CreateUpdateTestHelperParams = {
  version: number;
};

const createUpdateTestHelper = (params?: CreateUpdateTestHelperParams) => {
  const version = params?.version || 0;
  const publicData: UpdatePublicData = {
    refSnapshotId: snapshotId,
    docId,
    pubKey: clientAPublicKey,
  };

  const update = createUpdate(
    "u",
    publicData,
    key,
    clientAKeyPair,
    version,
    sodium
  );

  return { update: { ...update, serverData: { version } } };
};

const createEphemeralMessageTestHelper = ({
  messageType,
  receiverSessionId,
  content,
}: {
  messageType: "proof" | "message";
  receiverSessionId: string;
  content?: Uint8Array;
}) => {
  if (messageType === "proof") {
    const proof = createEphemeralMessageProof(
      receiverSessionId,
      clientASessionId,
      clientAKeyPair,
      sodium
    );

    const ephemeralMessage = createEphemeralMessage(
      proof,
      "proof",
      clientAPublicData,
      key,
      clientAKeyPair,
      clientASessionId,
      clientACounter,
      sodium
    );
    clientACounter++;
    return { ephemeralMessage };
  } else {
    const ephemeralMessage = createEphemeralMessage(
      content ? content : new Uint8Array([22]),
      "message",
      clientAPublicData,
      key,
      clientAKeyPair,
      clientASessionId,
      clientACounter,
      sodium
    );
    clientACounter++;
    return { ephemeralMessage };
  }
};

test("set _documentDecryptionState to failed if not even the snapshot can be loaded", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidCollaborator: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => {
          throw new Error("INVALID");
        },
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.value === "failed") {
      expect(state.context._documentDecryptionState).toBe("failed");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });
});

test("set _documentDecryptionState to partial and apply the first update, if document snapshot decrypts but the second update fails", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidCollaborator: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.value === "failed") {
      expect(state.context._documentDecryptionState).toBe("partial");
      expect(docValue).toEqual("Hello Worldu");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
      updates: [
        createUpdateTestHelper().update,
        createUpdateTestHelper({ version: 1000 }).update,
      ],
    },
  });
});

test("set _documentDecryptionState to partial, if document snapshot decrypts but the first update fails", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidCollaborator: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.value === "failed") {
      expect(state.context._documentDecryptionState).toBe("partial");
      expect(docValue).toEqual("Hello World");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
      updates: [createUpdateTestHelper({ version: 1000 }).update],
    },
  });
});

test("store not more than 20 receiving failed ephemeral message errors", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidCollaborator: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      ephemeralMessagesValue.length === 1 &&
      state.matches("connected.idle")
    ) {
      expect(state.context._ephemeralMessageReceivingErrors.length).toEqual(20);
      expect(ephemeralMessagesValue[0]).toEqual(22);
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const receiverSessionId =
    syncService.getSnapshot().context._ephemeralMessagesSession.id;

  const { ephemeralMessage } = createEphemeralMessageTestHelper({
    messageType: "proof",
    receiverSessionId,
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessage,
      type: "ephemeral-message",
    },
  });

  for (let step = 0; step < 25; step++) {
    const { ephemeralMessage: ephemeralMessageX } =
      createEphemeralMessageTestHelper({
        messageType: "message",
        receiverSessionId,
      });
    syncService.send({
      type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
      data: {
        ...ephemeralMessageX,
        signature: "BROKEN",
        type: "ephemeral-message",
      },
    });
  }

  const { ephemeralMessage: ephemeralMessageLast } =
    createEphemeralMessageTestHelper({
      messageType: "message",
      receiverSessionId,
    });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessageLast,
      type: "ephemeral-message",
    },
  });
});

test("reset the context entries after websocket disconnect", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidCollaborator: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.matches("connecting.retrying")) {
      expect(state.context._documentDecryptionState).toEqual("pending");
      expect(state.context._activeSnapshotInfo).toEqual(null);
      expect(state.context._incomingQueue).toEqual([]);
      expect(state.context._customMessageQueue).toEqual([]);
      expect(state.context._snapshotInFlight).toEqual(null);
      expect(state.context._updatesInFlight).toEqual([]);
      expect(state.context._updatesConfirmedClock).toEqual(null);
      expect(state.context._updatesLocalClock).toEqual(-1);
      expect(state.context._updatesClocks).toEqual({});
      expect(state.context._ephemeralMessagesSession).not.toBe(null);
      expect(state.context._ephemeralMessageReceivingErrors).toEqual([]);
      expect(state.context._ephemeralMessageAuthoringErrors).toEqual([]);
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
      updates: [
        createUpdateTestHelper().update,
        createUpdateTestHelper({ version: 1 }).update,
      ],
    },
  });

  syncService.send({
    type: "WEBSOCKET_DISCONNECTED",
  });
});

test("reconnect and reload the document", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();
  let reconnected = false;

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidCollaborator: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      reconnected &&
      state.matches("connected.idle") &&
      state.context._documentDecryptionState
    ) {
      expect(docValue).toEqual("Hello Worlduu");
      expect(state.context._documentDecryptionState).toEqual("complete");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  const document = {
    type: "document",
    snapshot,
    updates: [
      createUpdateTestHelper().update,
      createUpdateTestHelper({ version: 1 }).update,
    ],
  };
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: document,
  });

  syncService.send({
    type: "WEBSOCKET_DISCONNECTED",
  });
  setTimeout(() => {
    syncService.send({ type: "WEBSOCKET_RETRY" });
    syncService.send({ type: "WEBSOCKET_CONNECTED" });
    syncService.send({
      type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
      data: document,
    });
    reconnected = true;
  }, 1);
});

test("store not more than 20 failed creating ephemeral message errors", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();
  let transitionCount = 0;

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidCollaborator: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    transitionCount = transitionCount + 1;
    // console.log("transitionCount", transitionCount);
    if (transitionCount === 27 && state.matches("connected.idle")) {
      expect(state.context._ephemeralMessageAuthoringErrors.length).toEqual(20);
      expect(state.context._ephemeralMessageAuthoringErrors[0].message).toEqual(
        `Wrong ephemeral message key #${23}`
      );
      expect(
        state.context._ephemeralMessageAuthoringErrors[19].message
      ).toEqual(`Wrong ephemeral message key #${4}`);
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  for (let step = 0; step < 25; step++) {
    syncService.send({
      type: "FAILED_CREATING_EPHEMERAL_UPDATE",
      error: new Error(`Wrong ephemeral message key #${step}`),
    });
  }
});

test("fails in case the collaborator is not valid", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidCollaborator: (signingPublicKey) => false,
        getSnapshotKey: () => key,

        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.value === "failed") {
      expect(state.context._documentDecryptionState).toBe("failed");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });
});
