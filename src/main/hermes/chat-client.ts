/**
 * Chat client compatibility barrel.
 *
 * The send paths and message helpers live in focused leaf modules; this file
 * preserves existing imports from "./hermes/chat-client".
 */

export * from "./chat-client/messages";
export * from "./chat-client/completion";
export * from "./chat-client/api";
export * from "./chat-client/cli";
export * from "./chat-client/send";
