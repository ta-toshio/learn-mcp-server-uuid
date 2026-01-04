# UUID MCP Server

MCP（Model Context Protocol）の学習用サーバーです。UUIDの生成・検証機能を通じて、MCPの基本構造を理解できます。

## MCP とは

MCP（Model Context Protocol）は、AIモデル（Claude等）と外部ツール・データソースを接続するためのプロトコルです。

### 主要な概念

| 概念 | 説明 | このプロジェクトでの例 |
|------|------|----------------------|
| **Tool** | AIが実行できるアクション | `generate_uuid`, `validate_uuid` |
| **Resource** | AIが読み取れるデータ | `uuid://history`（生成履歴） |
| **Transport** | 通信方式 | stdio, Streamable HTTP |

### 通信プロトコル

MCPは **JSON-RPC 2.0** をベースにしています。

```json
// リクエスト例（ツール呼び出し）
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "generate_uuid",
    "arguments": { "version": "v4", "count": 1 }
  }
}

// レスポンス例
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "生成されたUUID (v4): ..." }]
  }
}
```

## クイックスタート

### 1. ビルド

```bash
cd uuid-mcp
pnpm install
pnpm run build
```

### 2. 動作確認

#### stdio モード（ローカル）

```bash
pnpm run start
```

#### HTTP モード（リモート）

```bash
pnpm run start:http
# または
pnpm run start:http --port=3001
```

### 3. Claude Code での設定

#### stdio モード（推奨）

```bash
claude mcp add uuid-mcp \
  --transport stdio \
  --scope project \
  -- node /path/to/uuid-mcp/dist/index.js
```

#### HTTP モード（mcp-remote 使用）

```bash
claude mcp add uuid \
  -- npx mcp-remote http://localhost:3000/mcp
```

### 4. .mcp.json での設定

プロジェクトルートに `.mcp.json` を作成して設定することも可能です。

#### stdio モード

```json
{
  "mcpServers": {
    "uuid": {
      "command": "node",
      "args": ["/path/to/uuid-mcp/dist/index.js"]
    }
  }
}
```

#### HTTP モード（mcp-remote 使用）

```json
{
  "mcpServers": {
    "uuid": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

> **Note:** HTTP モードを使用する場合は、事前に `pnpm run start:http` でサーバーを起動しておく必要があります。

## 提供ツール

### generate_uuid

UUIDを生成します。

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `version` | `"v4"` \| `"v7"` | `"v4"` | UUIDバージョン |
| `count` | `1-10` | `1` | 生成数 |

**使用例:**
```
「UUID v7を3つ生成してください」
→ generate_uuid({ version: "v7", count: 3 })
```

### validate_uuid

UUID文字列を検証します。

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `uuid` | `string` | 検証するUUID |

**使用例:**
```
「この文字列がUUIDかどうか確認してください: 550e8400-e29b-41d4-a716-446655440000」
→ validate_uuid({ uuid: "550e8400-e29b-41d4-a716-446655440000" })
```

## 提供リソース

### uuid://history

セッション中に生成されたUUIDの履歴を取得します。

**レスポンス例:**
```json
{
  "totalCount": 5,
  "history": [
    { "uuid": "...", "version": "v4", "createdAt": "2026-01-03T..." }
  ]
}
```

## トランスポートの違い

### stdio（標準入出力）

```
┌──────────────┐     stdin/stdout     ┌──────────────┐
│ Claude       │ ◄──────────────────► │ MCP Server   │
│ (クライアント)│      JSON-RPC       │ (プロセス)    │
└──────────────┘                      └──────────────┘
```

- **用途**: ローカル環境でのプロセス起動
- **利点**: セットアップが簡単、ポート不要
- **欠点**: ローカルプロセスに限定

### Streamable HTTP

```
┌──────────────┐       HTTP           ┌──────────────┐
│ Claude       │ ◄──────────────────► │ MCP Server   │
│ (クライアント)│   POST/GET/DELETE   │ (Webサーバー) │
└──────────────┘      /mcp            └──────────────┘
```

- **用途**: リモートサーバーやWebベースのクライアント
- **利点**: ネットワーク越しにアクセス可能
- **欠点**: ポート管理が必要

## プロジェクト構造

```
uuid-mcp/
├── src/
│   ├── index.ts    # エントリーポイント（トランスポート選択）
│   └── server.ts   # MCPサーバーロジック（ツール・リソース定義）
├── package.json
├── tsconfig.json
└── README.md
```

## 学習ポイント

### 1. サーバー基本構造 (`src/server.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// サーバーインスタンス作成
const server = new McpServer({
  name: "uuid-mcp",
  version: "1.0.0"
});

// ツール登録
server.tool("generate_uuid", "説明", { /* schema */ }, async (args) => {
  return { content: [{ type: "text", text: "結果" }] };
});

// リソース登録
server.resource("uuid-history", "uuid://history", { /* meta */ }, async () => {
  return { contents: [{ uri: "uuid://history", text: "..." }] };
});
```

### 2. stdio トランスポート (`src/index.ts`)

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 3. HTTP トランスポート (`src/index.ts`)

```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
  onsessioninitialized: (id) => sessions.set(id, transport)
});
await server.connect(transport);
```

## 開発コマンド

```bash
pnpm run dev        # 開発モード（stdio）
pnpm run dev:http   # 開発モード（HTTP）
pnpm run build      # ビルド
pnpm run typecheck  # 型チェック
pnpm run lint       # リント
pnpm run lint:fix   # リント自動修正
```

## ライセンス

MIT
