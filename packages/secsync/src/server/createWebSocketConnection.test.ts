import { IncomingMessage } from "http";
import sodium from "libsodium-wrappers";
import { WebSocket } from "ws";
import { createWebSocketConnection } from "./createWebSocketConnection";
import { addConnection, addUpdate, removeConnection } from "./store";

// mock the WebSocket class
jest.mock("ws");
jest.mock("./store");

let mockWs: WebSocket;
let mockReq: IncomingMessage;

beforeEach(async () => {
  await sodium.ready;
  // Initialize mocks for each test
  mockWs = new WebSocket("localhost:8888");
  mockReq = { url: "/test-document" } as IncomingMessage;

  (addConnection as jest.Mock).mockClear();
  (addUpdate as jest.Mock).mockClear();
  (removeConnection as jest.Mock).mockClear();
});

it("should handle document error if URL is undefined", async () => {
  mockReq.url = undefined;

  const mockGetDocument = jest.fn();
  const mockCreateSnapshot = jest.fn();
  const mockCreateUpdate = jest.fn();
  const mockHasAccess = jest.fn().mockReturnValue(true);

  const connection = createWebSocketConnection({
    getDocument: mockGetDocument,
    createSnapshot: mockCreateSnapshot,
    createUpdate: mockCreateUpdate,
    hasAccess: mockHasAccess,
  });

  await connection(mockWs, mockReq);

  expect(mockWs.send).toHaveBeenCalledWith(
    JSON.stringify({ type: "document-error" })
  );
  expect(mockWs.close).toHaveBeenCalledTimes(1);
  expect(removeConnection).toHaveBeenCalledWith("", mockWs);
});

it("should close connection if unauthorized for read access", async () => {
  mockReq.url = "/test-document";

  const mockHasAccess = jest.fn().mockReturnValue(false);

  const connection = createWebSocketConnection({
    getDocument: jest.fn(),
    createSnapshot: jest.fn(),
    createUpdate: jest.fn(),
    hasAccess: mockHasAccess,
  });

  await connection(mockWs, mockReq);

  expect(mockHasAccess).toHaveBeenCalledWith({
    action: "read",
    documentId: "test-document",
  });
  expect(mockWs.send).toHaveBeenCalledWith(
    JSON.stringify({ type: "unauthorized" })
  );
  expect(mockWs.close).toHaveBeenCalledTimes(1);
});

it("should close connection if document not found", async () => {
  mockReq.url = "/test-document";

  const mockGetDocument = jest.fn().mockReturnValue(undefined);
  const mockHasAccess = jest.fn().mockReturnValue(true);

  const connection = createWebSocketConnection({
    getDocument: mockGetDocument,
    createSnapshot: jest.fn(),
    createUpdate: jest.fn(),
    hasAccess: mockHasAccess,
  });

  await connection(mockWs, mockReq);

  expect(mockWs.send).toHaveBeenCalledWith(
    JSON.stringify({ type: "document-not-found" })
  );
  expect(mockWs.close).toHaveBeenCalledTimes(1);
});

it("should add connection and send document if found", async () => {
  mockReq.url = "/test-document";

  const mockDocument = {
    snapshot: {},
    updates: [],
    snapshotProofChain: [],
  };

  const mockGetDocument = jest.fn().mockReturnValue(mockDocument);
  const mockHasAccess = jest.fn().mockReturnValue(true);

  const connection = createWebSocketConnection({
    getDocument: mockGetDocument,
    createSnapshot: jest.fn(),
    createUpdate: jest.fn(),
    hasAccess: mockHasAccess,
  });

  await connection(mockWs, mockReq);

  expect(mockGetDocument).toHaveBeenCalledWith({
    documentId: "test-document",
  });
  expect(addConnection).toHaveBeenCalledWith("test-document", mockWs);
  expect(mockWs.send).toHaveBeenCalledWith(
    JSON.stringify({ type: "document", ...mockDocument })
  );
});

it("should properly parse and send through lastKnownSnapshotId & lastKnownSnapshotUpdatesClocks", async () => {
  const mockDocument = {
    snapshot: {},
    updates: [],
    snapshotProofChain: [],
  };

  const mockGetDocument = jest.fn().mockReturnValue(mockDocument);
  const mockHasAccess = jest.fn().mockReturnValue(true);

  const connection = createWebSocketConnection({
    getDocument: mockGetDocument,
    createSnapshot: jest.fn(),
    createUpdate: jest.fn(),
    hasAccess: mockHasAccess,
  });

  mockReq.url = "/test-document?lastKnownSnapshotId=123";
  await connection(mockWs, mockReq);

  expect(mockGetDocument).toHaveBeenCalledWith({
    documentId: "test-document",
    lastKnownSnapshotId: "123",
  });

  mockReq.url = "/test-document?lastKnownSnapshotId=555";
  await connection(mockWs, mockReq);

  expect(mockGetDocument).toHaveBeenCalledWith({
    documentId: "test-document",
    lastKnownSnapshotId: "555",
  });

  const lastKnownSnapshotUpdatesClocks = { yhj: 1, jkl: 2 };
  const lastKnownSnapshotUpdatesClocksQuery = encodeURIComponent(
    JSON.stringify(lastKnownSnapshotUpdatesClocks)
  );
  mockReq.url = `/test-document?lastKnownSnapshotId=42&lastKnownSnapshotUpdatesClocks=${lastKnownSnapshotUpdatesClocksQuery}`;
  await connection(mockWs, mockReq);

  expect(mockGetDocument).toHaveBeenCalledWith({
    documentId: "test-document",
    lastKnownSnapshotId: "42",
    lastKnownSnapshotUpdatesClocks: { yhj: 1, jkl: 2 },
  });
});