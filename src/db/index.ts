import { Database } from 'bun:sqlite'
import { randomUUID } from 'crypto'

const db = new Database('llm_proxy.db')
db.run("PRAGMA journal_mode = WAL;")
db.run("PRAGMA synchronous = NORMAL;")

// Create tables
db.run(`CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
)`)

db.run(`CREATE TABLE IF NOT EXISTS conversation_items (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  reasoning_content TEXT,
  reasoning_details TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  name TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
)`)

// Prepared statements for performance
const stmts = {
  getConversation: db.prepare('SELECT * FROM conversations WHERE id = ?'),
  getConversationItems: db.prepare('SELECT * FROM conversation_items WHERE conversation_id = ? ORDER BY created_at ASC'),
  insertConversation: db.prepare('INSERT OR IGNORE INTO conversations (id) VALUES (?)'),
  insertItem: db.prepare('INSERT INTO conversation_items (id, conversation_id, role, content, reasoning_content, reasoning_details, tool_calls, tool_call_id, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  updateConversation: db.prepare('UPDATE conversations SET updated_at = unixepoch() WHERE id = ?'),
}

export function getConversation(id: string) {
  return stmts.getConversation.get(id)
}

export function getConversationItems(convId: string) {
  return stmts.getConversationItems.all(convId)
}

export function appendItems(convId: string, items: any[]) {
  db.transaction(() => {
    stmts.insertConversation.run(convId)
    for (const item of items) {
      stmts.insertItem.run(
        item.id || randomUUID(),
        convId,
        item.role,
        item.content || null,
        item.reasoning_content || null,
        item.reasoning_details ? JSON.stringify(item.reasoning_details) : null,
        item.tool_calls ? JSON.stringify(item.tool_calls) : null,
        item.tool_call_id || null,
        item.name || null
      )
    }
    stmts.updateConversation.run(convId)
  })()
}

export { db }
