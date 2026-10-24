const { Server } = require("socket.io");
const { verifyToken } = require("../utils/jwt");
const { prisma } = require("./prisma");
const logger = require("../utils/logger");

let io = null;

/**
 * User room naming: every authenticated socket joins `user:<userId>` so a
 * single event can be targeted at one person regardless of how many tabs/
 * devices they have open.
 *
 * Challenge room naming: a client explicitly joins `challenge:<challengeId>`
 * (see the "challenge:join" handler below) when it's actively viewing that
 * challenge's page, so evaluation/roster/rule updates can be pushed to
 * everyone currently looking at it without broadcasting to every connected
 * client.
 */
const userRoom = (userId) => `user:${userId}`;
const challengeRoom = (challengeId) => `challenge:${challengeId}`;

/**
 * Attach Socket.IO to an existing HTTP server (the same one Express is
 * already listening on) and wire up JWT-based handshake authentication.
 * Call this once from server.js after the HTTP server is created.
 */
const initializeSocket = (httpServer, corsOrigins) => {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
  });

  // Authenticate the socket handshake the same way HTTP requests are
  // authenticated - a bearer JWT, just passed via the socket.io auth
  // payload instead of an Authorization header, since a WebSocket
  // handshake has no per-message header of its own.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, username: true },
      });

      if (!user) {
        return next(new Error("User not found"));
      }

      socket.userId = user.id;
      socket.username = user.username;
      next();
    } catch (error) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(userRoom(socket.userId));
    logger.debug(`Socket connected: ${socket.username} (${socket.id})`);

    // A client asks to receive live updates for a specific challenge page.
    // We don't verify membership here beyond authentication - the same
    // events these rooms carry (leaderboard/roster/rule changes) are
    // already readable by anyone with the challenge id via the existing
    // REST endpoints, so this isn't a new authorization boundary.
    socket.on("challenge:join", (challengeId) => {
      if (typeof challengeId === "string") {
        socket.join(challengeRoom(challengeId));
      }
    });

    socket.on("challenge:leave", (challengeId) => {
      if (typeof challengeId === "string") {
        socket.leave(challengeRoom(challengeId));
      }
    });

    socket.on("disconnect", () => {
      logger.debug(`Socket disconnected: ${socket.username} (${socket.id})`);
    });
  });

  logger.info("Socket.IO server initialized");
  return io;
};

/**
 * Emit an event to every connection a specific user has open. Safe to call
 * even if Socket.IO hasn't been initialized (e.g. in a test/CLI context) -
 * it just becomes a no-op rather than throwing.
 */
const emitToUser = (userId, event, payload) => {
  if (!io) return;
  io.to(userRoom(userId)).emit(event, payload);
};

/**
 * Emit an event to every client currently viewing a given challenge.
 */
const emitToChallenge = (challengeId, event, payload) => {
  if (!io) return;
  io.to(challengeRoom(challengeId)).emit(event, payload);
};

/**
 * Emit an event to every connected client, regardless of room - used
 * sparingly (currently only for global-leaderboard refresh hints).
 */
const emitBroadcast = (event, payload) => {
  if (!io) return;
  io.emit(event, payload);
};

const getIO = () => io;

module.exports = {
  initializeSocket,
  emitToUser,
  emitToChallenge,
  emitBroadcast,
  getIO,
};
