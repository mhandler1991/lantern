// The transport's own bookkeeping, exercised without real peers. Real peers are
// `test-room.html` (CLAUDE.md §7); what is testable here is everything our layer does
// around Trystero — who a message is attributed to, what happens to a send with no
// peer to send it to, and whether leaving twice is safe.
//
// The fake room implements `RoomLike`, the same narrow seam the real `joinRoom` is
// checked against at compile time in `trystero.ts`. If Trystero's shape moves, that
// assignment fails typecheck; this file cannot drift away from it silently.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_EVENT_BYTES, TRYSTERO_ACTION_NAMESPACE, TRYSTERO_APP_ID } from '../constants';
import { joinTrysteroRoom, type JoinRoomLike, type RoomLike } from './trystero';
import type { JsonValue, TransportLogEntry, TransportMessage } from './transport';

const SELF_ID = 'f'.repeat(64);
const PEER_A = 'a'.repeat(64);
const PEER_B = 'b'.repeat(64);

type Sent = { data: JsonValue; target: string | undefined };

type Fake = {
  joinRoom: JoinRoomLike;
  /** Every `joinRoom` call, so appId and password can be asserted. */
  joins: { config: { appId: string; password?: string }; roomId: string }[];
  sent: Sent[];
  leaveCount: number;
  namespaces: string[];
  peerJoin: (peerId: string) => void;
  peerLeave: (peerId: string) => void;
  message: (data: JsonValue, peerId: string) => void;
  joinError: (error: string) => void;
  /** Makes the next `send` reject, as a data channel that closed mid-send would. */
  failNextSend: (message: string) => void;
  /** Makes `leave()` reject. */
  failLeave: (message: string) => void;
};

function makeFake(options: { throwOnJoin?: string } = {}): Fake {
  const fake: Partial<Fake> = { joins: [], sent: [], leaveCount: 0, namespaces: [] };
  let sendFailure: string | null = null;
  let leaveFailure: string | null = null;
  let room: RoomLike | null = null;

  fake.joinRoom = (config, roomId, callbacks) => {
    if (options.throwOnJoin !== undefined) {
      throw new Error(options.throwOnJoin);
    }

    fake.joins?.push({ config, roomId });

    room = {
      onPeerJoin: null,
      onPeerLeave: null,
      getPeers: () => ({}),
      makeAction: (namespace, actionConfig) => {
        fake.namespaces?.push(namespace);
        fake.message = (data, peerId) => actionConfig?.onMessage?.(data, { peerId });

        return {
          send: async (data, sendOptions) => {
            if (sendFailure !== null) {
              const message = sendFailure;
              sendFailure = null;
              throw new Error(message);
            }
            fake.sent?.push({ data, target: sendOptions?.target });
          },
        };
      },
      leave: async () => {
        fake.leaveCount = (fake.leaveCount ?? 0) + 1;
        if (leaveFailure !== null) {
          throw new Error(leaveFailure);
        }
      },
    };

    fake.joinError = (error) => callbacks?.onJoinError?.({ error });
    fake.peerJoin = (peerId) => room?.onPeerJoin?.(peerId);
    fake.peerLeave = (peerId) => room?.onPeerLeave?.(peerId);

    return room;
  };

  fake.failNextSend = (message) => {
    sendFailure = message;
  };
  fake.failLeave = (message) => {
    leaveFailure = message;
  };

  return fake as Fake;
}

let fake: Fake;
let log: TransportLogEntry[];
let received: TransportMessage[];
let joined: string[];
let left: string[];
let errors: { kind: string; message: string }[];

beforeEach(() => {
  fake = makeFake();
  log = [];
  received = [];
  joined = [];
  left = [];
  errors = [];
});

function join(roomId = 'ABCDEF', password?: string) {
  const result = joinTrysteroRoom(
    {
      roomId,
      ...(password === undefined ? {} : { password }),
      log: (entry) => log.push(entry),
      handlers: {
        onMessage: (message) => received.push(message),
        onPeerJoin: (peerId) => joined.push(peerId),
        onPeerLeave: (peerId) => left.push(peerId),
        onError: (error) => errors.push(error),
      },
    },
    { joinRoom: fake.joinRoom, selfId: SELF_ID },
  );

  if (!result.ok) {
    throw new Error(`expected a joined transport, got ${result.error.kind}`);
  }

  return result.value;
}

describe('joining', () => {
  it('namespaces the room by the app id and reports our own peer id', () => {
    const transport = join('ABCDEF');

    expect(fake.joins).toEqual([{ config: { appId: TRYSTERO_APP_ID }, roomId: 'ABCDEF' }]);
    expect(fake.namespaces).toEqual([TRYSTERO_ACTION_NAMESPACE]);
    expect(transport.selfId).toBe(SELF_ID);
    expect(transport.roomId).toBe('ABCDEF');
    expect(transport.getPeers()).toEqual([]);
  });

  it('passes a password through only when one was given', () => {
    join('ABCDEF', 'lanternlight');
    expect(fake.joins[0]?.config.password).toBe('lanternlight');

    fake = makeFake();
    join('ABCDEF');
    expect(fake.joins[0]).not.toHaveProperty('password');
  });

  it('returns a failure rather than throwing when the room cannot be created', () => {
    fake = makeFake({ throwOnJoin: 'relay list is empty' });

    const result = joinTrysteroRoom(
      { roomId: 'ABCDEF', log: (entry) => log.push(entry) },
      { joinRoom: fake.joinRoom, selfId: SELF_ID },
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: 'join-failed', message: 'relay list is empty' },
    });
    expect(log.at(-1)?.level).toBe('error');
  });

  it('reports a refused join to the error handler once the room exists', () => {
    join();
    fake.joinError('no relay accepted the announcement');

    expect(errors).toEqual([
      {
        kind: 'join-refused',
        message: 'no relay accepted the announcement (room "ABCDEF")',
      },
    ]);
  });
});

describe('peer events', () => {
  it('tracks peers and logs every join and leave', () => {
    const transport = join();

    fake.peerJoin(PEER_A);
    fake.peerJoin(PEER_B);
    expect(transport.getPeers()).toEqual([PEER_A, PEER_B]);

    fake.peerLeave(PEER_A);
    expect(transport.getPeers()).toEqual([PEER_B]);

    expect(joined).toEqual([PEER_A, PEER_B]);
    expect(left).toEqual([PEER_A]);

    const messages = log.map((entry) => entry.message);
    expect(messages).toContain('peer joined aaaaaaaa (1 connected)');
    expect(messages).toContain('peer joined bbbbbbbb (2 connected)');
    expect(messages).toContain('peer left aaaaaaaa (1 connected)');
  });
});

describe('receiving', () => {
  it('attributes a message to the transport peer id, never to the payload', () => {
    // CLAUDE.md §2.8. The payload claims to be from someone else and is not believed.
    join();
    fake.peerJoin(PEER_A);
    fake.message({ v: 1, t: 'roll', from: PEER_B }, PEER_A);

    expect(received).toEqual([{ from: PEER_A, data: { v: 1, t: 'roll', from: PEER_B } }]);
  });

  it('logs the first message from a peer and not the rest', () => {
    join();
    fake.message('one', PEER_A);
    fake.message('two', PEER_A);

    const firsts = log.filter((entry) => entry.message.includes('first message'));
    expect(firsts).toHaveLength(1);
    expect(firsts[0]?.message).toContain('aaaaaaaa');
  });

  it('drops an oversized message instead of handing it up', () => {
    join();
    fake.message('x'.repeat(MAX_EVENT_BYTES), PEER_A);

    expect(received).toEqual([]);
    expect(errors[0]?.kind).toBe('too-large');
    expect(errors[0]?.message).toContain('aaaaaaaa');
  });

  it('ignores a message that arrives after leaving', async () => {
    const transport = join();
    await transport.leave();
    fake.message('late', PEER_A);

    expect(received).toEqual([]);
  });
});

describe('sending', () => {
  it('broadcasts to everyone with no target', async () => {
    const transport = join();

    await expect(transport.broadcast({ v: 1, t: 'state' })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(fake.sent).toEqual([{ data: { v: 1, t: 'state' }, target: undefined }]);
  });

  it('addresses one peer by id', async () => {
    const transport = join();
    fake.peerJoin(PEER_A);

    await transport.sendTo(PEER_A, { v: 1, t: 'request' });
    expect(fake.sent).toEqual([{ data: { v: 1, t: 'request' }, target: PEER_A }]);
  });

  it('refuses a peer it is not connected to rather than reporting a delivery', async () => {
    // Trystero's own send only console.warns for a missing target and resolves, which
    // would read to the caller as success.
    const transport = join();

    const result = await transport.sendTo(PEER_A, { v: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unknown-peer');
    }
    expect(fake.sent).toEqual([]);
    expect(errors[0]?.kind).toBe('unknown-peer');
  });

  it('refuses an oversized payload before it reaches the wire', async () => {
    const transport = join();

    const result = await transport.broadcast('x'.repeat(MAX_EVENT_BYTES));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('too-large');
    }
    expect(fake.sent).toEqual([]);
  });

  it('reports a transport failure as a value', async () => {
    const transport = join();
    fake.failNextSend('data channel is closed');

    const result = await transport.broadcast({ v: 1 });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'transport-failed', message: 'send to everyone failed: data channel is closed' },
    });
  });

  it('refuses to send after leaving', async () => {
    const transport = join();
    await transport.leave();

    const result = await transport.broadcast({ v: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not-joined');
    }
    expect(fake.sent).toEqual([]);
  });
});

describe('leaving', () => {
  it('leaves once however many times it is called, and forgets its peers', async () => {
    const transport = join();
    fake.peerJoin(PEER_A);

    await expect(transport.leave()).resolves.toEqual({ ok: true, value: undefined });
    await expect(transport.leave()).resolves.toEqual({ ok: true, value: undefined });

    expect(fake.leaveCount).toBe(1);
    expect(transport.getPeers()).toEqual([]);
  });

  it('detaches the peer callbacks so a late event cannot reach a dead transport', async () => {
    const transport = join();
    await transport.leave();

    fake.peerJoin(PEER_B);
    expect(joined).toEqual([]);
    expect(transport.getPeers()).toEqual([]);
  });

  it('reports a failure to leave as a value', async () => {
    const transport = join();
    fake.failLeave('socket already closed');

    const result = await transport.leave();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('transport-failed');
    }
  });
});

describe('the default log sink', () => {
  it('prints peer events to the console', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      const result = joinTrysteroRoom({ roomId: 'ABCDEF' }, {
        joinRoom: fake.joinRoom,
        selfId: SELF_ID,
      });
      expect(result.ok).toBe(true);
      fake.peerJoin(PEER_A);

      expect(info).toHaveBeenCalledWith('[lantern:net] peer joined aaaaaaaa (1 connected)');
    } finally {
      info.mockRestore();
    }
  });
});
