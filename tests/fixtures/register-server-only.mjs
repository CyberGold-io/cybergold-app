import { register } from "node:module";

// Unit tests execute in Node, outside Next's server-only module aliasing.
register("./server-only-loader.mjs", import.meta.url);
