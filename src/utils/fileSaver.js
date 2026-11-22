import fs from "fs";
import path from "path";
import { MemorySaver } from "@langchain/langgraph";

function serializeReplacer(key, value) {
  if (value instanceof Uint8Array || (value && value.type === "Buffer" && Array.isArray(value.data))) {
    return { __type: "Uint8Array", data: Array.from(value.data || value) };
  }
  return value;
}

function deserializeReviver(key, value) {
  if (value && typeof value === "object" && value.__type === "Uint8Array" && Array.isArray(value.data)) {
    return new Uint8Array(value.data);
  }
  return value;
}

/**
 * FileSaver — Persistent File-based Checkpointer for LangGraph
 * 
 * Extends MemorySaver to serialize state checkpoints to disk.
 * Handles Uint8Array binary serialization for @langchain/langgraph-checkpoint serde.
 */
export class FileSaver extends MemorySaver {
  constructor(filePath = "./.checkpoints.json") {
    super();
    this.filePath = path.resolve(filePath);
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw, deserializeReviver);
        this.storage = data.storage || {};
        this.writes = data.writes || {};
      }
    } catch (e) {
      console.warn(`⚠️ Could not load file checkpointer from ${this.filePath}: ${e.message}`);
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.filePath,
        JSON.stringify({ storage: this.storage, writes: this.writes }, serializeReplacer, 2)
      );
    } catch (e) {
      console.warn(`⚠️ Could not save file checkpointer to ${this.filePath}: ${e.message}`);
    }
  }

  async put(config, checkpoint, metadata, newVersions) {
    const res = await super.put(config, checkpoint, metadata, newVersions);
    this._save();
    return res;
  }

  async putWrites(config, writes, taskId) {
    const res = await super.putWrites(config, writes, taskId);
    this._save();
    return res;
  }

  async deleteThread(threadId) {
    let deleted = false;
    if (typeof super.deleteThread === "function") {
      try {
        await super.deleteThread(threadId);
        deleted = true;
      } catch (_) {}
    }
    if (this.storage && this.storage[threadId]) {
      delete this.storage[threadId];
      deleted = true;
    }
    if (this.writes) {
      if (this.writes[threadId]) {
        delete this.writes[threadId];
        deleted = true;
      }
      for (const k of Object.keys(this.writes)) {
        if (k.startsWith(`${threadId}:`) || k.startsWith(`${threadId}/`) || k === threadId) {
          delete this.writes[k];
          deleted = true;
        }
      }
    }
    this._save();
    return deleted;
  }
}
