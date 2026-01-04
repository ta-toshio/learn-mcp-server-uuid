# MCP（Model Context Protocol）完全ガイド

本ドキュメントは、uuid-mcpプロジェクトを題材に、MCPの全体像を解説します。

---

## 目次

1. [MCPとは何か](#1-mcpとは何か)
2. [アーキテクチャ全体像](#2-アーキテクチャ全体像)
3. [基本構造：サーバー、ツール、リソース](#3-基本構造サーバーツールリソース)
4. [通信プロトコル：JSON-RPC 2.0](#4-通信プロトコルjson-rpc-20)
5. [トランスポート層：stdioとHTTP](#5-トランスポート層stdioとhttp)
6. [Claude連携：設定とツール呼び出しの流れ](#6-claude連携設定とツール呼び出しの流れ)
7. [実践：uuid-mcpのコード解説](#7-実践uuid-mcpのコード解説)

---

## 1. MCPとは何か

### 1.1 概要

**MCP（Model Context Protocol）** は、AIモデル（Claude等）と外部システムを接続するための標準プロトコルです。

```
┌─────────────────┐                      ┌─────────────────┐
│                 │      MCP Protocol    │                 │
│     Claude      │ ◄──────────────────► │   MCP Server    │
│   (クライアント)  │      JSON-RPC       │  (ツール提供者)   │
│                 │                      │                 │
└─────────────────┘                      └─────────────────┘
```

### 1.2 なぜMCPが必要か

| 課題 | MCPによる解決 |
|------|--------------|
| AIが外部データにアクセスできない | **Resource** でデータを提供 |
| AIが外部アクションを実行できない | **Tool** でアクションを提供 |
| 各AIプラットフォームで異なる実装が必要 | **標準プロトコル** で統一 |

### 1.3 MCPの3つの柱

| 概念 | 役割 | 例 |
|------|------|-----|
| **Tool** | AIが実行できるアクション | `generate_uuid`, `send_email`, `query_database` |
| **Resource** | AIが読み取れるデータ | `file://`, `db://`, `uuid://history` |
| **Prompt** | 定型のプロンプトテンプレート | `summarize_code`, `review_pr` |

---

## 2. アーキテクチャ全体像

### 2.1 レイヤー構成

```
┌─────────────────────────────────────────────────────────────┐
│                        Claude (AI)                          │
│                    ユーザーの質問を解釈                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ ツール呼び出し決定
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     MCP クライアント                         │
│              Claude Desktop / Claude Code 内蔵               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ JSON-RPC メッセージ
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    トランスポート層                          │
│                  stdio または HTTP                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ JSON-RPC メッセージ
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     MCP サーバー                             │
│            ツール実行 / リソース提供 / プロンプト提供           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 外部システムアクセス
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      外部システム                            │
│           データベース / API / ファイルシステム等               │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 uuid-mcpの構成

```
uuid-mcp/
├── src/
│   ├── server.ts   ← MCPサーバーロジック（ツール・リソース定義）
│   └── index.ts    ← エントリーポイント（トランスポート選択）
├── dist/           ← ビルド成果物
└── package.json
```

**重要な設計原則**: サーバーロジック（`server.ts`）とトランスポート（`index.ts`）を分離することで、同じロジックをstdio/HTTP両方で使用可能にしています。

---

## 3. 基本構造：サーバー、ツール、リソース

### 3.1 MCPサーバーの作成

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// サーバーインスタンス作成
const server = new McpServer({
  name: "uuid-mcp",      // サーバー名（クライアントに通知される）
  version: "1.0.0"       // バージョン
});
```

**ポイント**:
- `McpServer` はツール・リソース・プロンプトを管理するコンテナ
- `name` と `version` は初期化時にクライアントへ通知される

### 3.2 ツール（Tool）の登録

ツールは **AIが実行できるアクション** です。

```typescript
import * as z from "zod";

server.registerTool(
  "generate_uuid",                                    // ① ツール名
  {                                                   // ② 設定オブジェクト
    title: "UUID Generator",                          //    表示名
    description: "UUIDを生成します。v4またはv7を選択できます。", // 説明（AIが読む）
    inputSchema: {                                    // ③ 入力スキーマ（Zod）
      version: z.enum(["v4", "v7"]).default("v4"),
      count: z.number().min(1).max(10).default(1)
    }
  },
  async ({ version, count }) => {                     // ④ 実行関数
    const uuid = crypto.randomUUID();
    return {
      content: [{ type: "text", text: `生成されたUUID: ${uuid}` }]
    };
  }
);
```

**各パラメータの役割**:

| # | パラメータ | 役割 |
|---|-----------|------|
| ① | ツール名 | クライアントがツールを呼び出す際の識別子 |
| ② | 設定オブジェクト | title（表示名）、description（説明）、inputSchema（入力）を含む |
| ③ | 入力スキーマ | 引数の型・制約を定義（Zodで記述） |
| ④ | 実行関数 | 実際の処理ロジック |

**戻り値の構造**:

```typescript
{
  content: [
    { type: "text", text: "テキストメッセージ" },
    { type: "image", data: "base64...", mimeType: "image/png" }
  ]
}
```

### 3.3 リソース（Resource）の登録

リソースは **AIが読み取れるデータ** です。

```typescript
server.registerResource(
  "uuid-history",           // ① リソース名
  "uuid://history",         // ② URI（一意の識別子）
  {                         // ③ メタデータ
    title: "UUID History",  //    表示名
    description: "生成されたUUIDの履歴",
    mimeType: "application/json"
  },
  async (uri) => {          // ④ データ取得関数（uriオブジェクトを受け取る）
    return {
      contents: [{
        uri: uri.href,      // 動的にURIを参照
        mimeType: "application/json",
        text: JSON.stringify({ history: [...] })
      }]
    };
  }
);
```

**ツールとリソースの違い**:

| 比較項目 | Tool | Resource |
|---------|------|----------|
| 目的 | アクションを実行 | データを取得 |
| 副作用 | あり得る（状態変更等） | なし（読み取り専用） |
| 入力 | 引数を受け取る | URIで識別 |
| 例 | UUID生成、メール送信 | 設定ファイル、履歴データ |

---

## 4. 通信プロトコル：JSON-RPC 2.0

### 4.1 JSON-RPC 2.0とは

MCPは **JSON-RPC 2.0** をベースにしています。これは、JSONフォーマットでリモートプロシージャコール（RPC）を行うための軽量プロトコルです。

### 4.2 メッセージ構造

**リクエスト**:
```json
{
  "jsonrpc": "2.0",      // プロトコルバージョン（固定）
  "id": 1,              // リクエストID（レスポンスと対応付け）
  "method": "tools/call", // 呼び出すメソッド
  "params": {           // パラメータ
    "name": "generate_uuid",
    "arguments": { "version": "v4", "count": 1 }
  }
}
```

**レスポンス（成功）**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,              // リクエストと同じID
  "result": {           // 実行結果
    "content": [{ "type": "text", "text": "生成されたUUID: ..." }]
  }
}
```

**レスポンス（エラー）**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32601,     // エラーコード
    "message": "Method not found"
  }
}
```

### 4.3 MCPで使用される主要メソッド

| メソッド | 方向 | 説明 |
|---------|------|------|
| `initialize` | Client → Server | セッション開始、機能ネゴシエーション |
| `tools/list` | Client → Server | 利用可能なツール一覧を取得 |
| `tools/call` | Client → Server | ツールを実行 |
| `resources/list` | Client → Server | 利用可能なリソース一覧を取得 |
| `resources/read` | Client → Server | リソースを読み取り |
| `prompts/list` | Client → Server | 利用可能なプロンプト一覧を取得 |
| `notifications/initialized` | Client → Server | 初期化完了通知 |

### 4.4 McpServerによる自動ハンドリング

上記のメソッドは、**`McpServer`クラスが内部で自動的に処理**します。開発者がこれらのJSON-RPCハンドラを直接実装する必要はありません。

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({ name: "uuid-mcp", version: "1.0.0" });

// 開発者はビジネスロジックのみを記述
server.registerTool("generate_uuid", { ... }, async (args) => { ... });
server.registerResource("uuid-history", "uuid://history", { ... }, async () => { ... });
```

**McpServerが内部で行う処理：**

| メソッド | McpServerの内部処理 |
|---------|-------------------|
| `initialize` | セッション初期化、登録されたツール/リソースの capabilities を自動通知 |
| `tools/list` | `registerTool()` で登録された全ツールの定義を自動返却 |
| `tools/call` | ツール名に対応するハンドラ関数を検索・実行、Zodスキーマによる入力バリデーション |
| `resources/list` | `registerResource()` で登録された全リソースの定義を自動返却 |
| `resources/read` | URIに対応するハンドラ関数を検索・実行 |
| `prompts/list` | `registerPrompt()` で登録された全プロンプトの定義を自動返却 |

**処理フロー図：**

```
┌─────────────────────────────────────────────────────────────┐
│ 開発者のコード                                               │
│   server.registerTool("generate_uuid", ...)                 │
│   server.registerResource("uuid-history", ...)              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ McpServer（内部処理）                                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 登録されたツール/リソースを内部Mapに保持              │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ JSON-RPCリクエストハンドラを自動登録                  │    │
│  │  - tools/list     → 登録ツール一覧を返却             │    │
│  │  - tools/call     → ツールハンドラを実行             │    │
│  │  - resources/list → 登録リソース一覧を返却           │    │
│  │  - resources/read → リソースハンドラを実行           │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 追加機能                                             │    │
│  │  - Zod → JSON Schema 自動変換                       │    │
│  │  - 入力バリデーション                                │    │
│  │  - エラーハンドリング                                │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**ポイント**: `McpServer`を使用することで、開発者はJSON-RPCプロトコルの詳細を意識することなく、ツールやリソースのビジネスロジックに集中できます。

### 4.5 通信シーケンス

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │ ─────── initialize ──────────────────► │
     │ ◄─────── capabilities ─────────────── │
     │                                         │
     │ ─────── notifications/initialized ───► │
     │                                         │
     │ ─────── tools/list ──────────────────► │
     │ ◄─────── tool definitions ────────── │
     │                                         │
     │ ─────── tools/call ──────────────────► │
     │          (generate_uuid)                │
     │ ◄─────── result ─────────────────────  │
     │                                         │
     ▼                                         ▼
```

---

## 5. トランスポート層：stdioとHTTP

### 5.1 トランスポートとは

**トランスポート**は、JSON-RPCメッセージを実際にやり取りする方法を定義します。MCPでは主に2つのトランスポートが使用されます。

### 5.2 stdio トランスポート

```
┌──────────────┐     stdin (JSON)     ┌──────────────┐
│ Claude       │ ──────────────────► │ MCP Server   │
│ Desktop      │                      │ (プロセス)    │
│              │ ◄────────────────── │              │
└──────────────┘     stdout (JSON)    └──────────────┘
```

**特徴**:
- プロセスの標準入出力（stdin/stdout）を使用
- Claude Desktopがサーバープロセスを直接起動
- ローカル環境専用
- ポート管理不要

**実装**:
```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const transport = new StdioServerTransport();
await server.connect(transport);

// 重要: stdoutはMCP通信に使用するため、ログはstderrに出力
console.error("Server started");
```

**使用場面**:
- Claude Desktop との連携
- ローカル開発環境
- セキュリティが重要な場合（ネットワーク露出なし）

### 5.3 Streamable HTTP トランスポート

```
┌──────────────┐       HTTP POST       ┌──────────────┐
│ Client       │ ──────────────────► │ MCP Server   │
│              │      /mcp            │ (Express)    │
│              │ ◄────────────────── │              │
│              │   JSON Response      │              │
│              │                      │              │
│              │       HTTP GET       │              │
│              │ ◄────────────────── │              │
│              │   SSE (通知)         │              │
└──────────────┘                      └──────────────┘
```

**特徴**:
- HTTPエンドポイント経由で通信
- セッション管理が必要（`mcp-session-id` ヘッダー）
- リモートアクセス可能
- Server-Sent Events (SSE) でサーバープッシュ対応

**実装**:
```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
const sessions = new Map();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && sessions.has(sessionId)) {
    // 既存セッションを再利用
    const transport = sessions.get(sessionId);
    await transport.handleRequest(req, res, req.body);
  } else if (isInitializeRequest(req.body)) {
    // 新規セッションを作成
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, transport)
    });
    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
});
```

**HTTPメソッドの役割**:

| メソッド | エンドポイント | 役割 |
|---------|---------------|------|
| POST | `/mcp` | JSON-RPCリクエストを処理 |
| GET | `/mcp` | SSEストリーム（サーバー通知用） |
| DELETE | `/mcp` | セッション終了 |

**使用場面**:
- リモートサーバーへのアクセス
- Webベースのクライアント
- 複数クライアントの同時接続

### 5.4 トランスポート比較

| 比較項目 | stdio | Streamable HTTP |
|---------|-------|-----------------|
| 通信方式 | プロセス間通信 | HTTP |
| セットアップ | 簡単 | サーバー設定必要 |
| セッション管理 | 不要 | 必要 |
| ネットワークアクセス | ローカルのみ | リモート可能 |
| セキュリティ | 高（露出なし） | 認証設計が必要 |
| 主な用途 | Claude Desktop | リモートサービス |

---

## 6. Claude連携：設定とツール呼び出しの流れ

### 6.1 Claude Desktop / Claude Code の設定

**stdio モード（推奨）**:

```bash
# Claude Code でのMCPサーバー追加
claude mcp add uuid-mcp \
  --transport stdio \
  --scope project \
  -- node /path/to/uuid-mcp/dist/index.js
```

これにより、以下のような設定が生成されます：

```json
// ~/.claude.json または .mcp.json
{
  "mcpServers": {
    "uuid-mcp": {
      "command": "node",
      "args": ["/path/to/uuid-mcp/dist/index.js"]
    }
  }
}
```

**HTTP モード（mcp-remote 使用）**:

```bash
# Claude Code でのMCPサーバー追加（HTTP）
claude mcp add uuid \
  -- npx mcp-remote http://localhost:3000/mcp
```

これにより、以下のような設定が生成されます：

```json
// ~/.claude.json または .mcp.json
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

### 6.2 ツール呼び出しの流れ

```
┌─────────────────────────────────────────────────────────────────────┐
│ ユーザー: 「UUIDを5つ生成して」                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Claude (AI) が解釈                                                   │
│ 「UUIDを生成するには generate_uuid ツールを使うべき」                    │
│ 「count=5 を指定する」                                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ MCPクライアント（Claude内蔵）                                         │
│ JSON-RPC リクエストを生成:                                            │
│ {                                                                    │
│   "method": "tools/call",                                            │
│   "params": { "name": "generate_uuid", "arguments": { "count": 5 } } │
│ }                                                                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ stdio / HTTP
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ MCPサーバー（uuid-mcp）                                               │
│ ツール実行関数を呼び出し → UUIDを5つ生成                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ レスポンス:                                                          │
│ {                                                                    │
│   "result": {                                                        │
│     "content": [{ "type": "text", "text": "1. abc-123...\n2. ..." }]│
│   }                                                                  │
│ }                                                                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Claude (AI) がユーザーに回答                                          │
│ 「5つのUUIDを生成しました: 1. abc-123... 2. def-456...」               │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 Claudeがツールを選択する仕組み

1. **ツール一覧の取得**: セッション開始時に `tools/list` で全ツールを取得
2. **ツール定義の理解**: 各ツールの `description` と入力スキーマを把握
3. **ユーザー意図の解釈**: ユーザーの発言から必要なアクションを判断
4. **最適なツール選択**: 説明文とスキーマに基づいて適切なツールを選択
5. **引数の決定**: ユーザーの発言から必要な引数を抽出・推論

**重要**: ツールの `description` は、Claudeがツールを選択する際の重要な判断材料です。分かりやすく具体的に書きましょう。

---

## 7. 実践：uuid-mcpのコード解説

### 7.1 ファイル構成と役割

```
src/
├── server.ts   # ビジネスロジック層
│               # - ツール定義（generate_uuid, validate_uuid）
│               # - リソース定義（uuid://history）
│               # - トランスポートに依存しない
│
└── index.ts    # インフラストラクチャ層
                # - コマンドライン引数解析
                # - トランスポート選択（stdio / HTTP）
                # - サーバー起動
```

### 7.2 server.ts の詳細解説

```typescript
// ========================================
// 1. インポート
// ========================================
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";  // スキーマ定義ライブラリ

// ========================================
// 2. 状態管理（リソース用）
// ========================================
// セッション中に生成したUUIDを記録
// これにより uuid://history リソースでアクセス可能
const uuidHistory: Array<{...}> = [];

// ========================================
// 3. サーバー作成関数
// ========================================
export function createUuidServer(): McpServer {
  const server = new McpServer({
    name: "uuid-mcp",
    version: "1.0.0"
  });

  // ========================================
  // 4. ツール登録
  // ========================================

  // 4.1 generate_uuid ツール
  server.registerTool(
    "generate_uuid",
    {
      title: "UUID Generator",
      description: "UUIDを生成します...",
      inputSchema: {
        // Zodでスキーマを定義
        // → 自動的にJSON Schemaに変換される
        // → Claudeがこのスキーマを見て引数を決定
        version: z.enum(["v4", "v7"]).default("v4"),
        count: z.number().min(1).max(10).default(1)
      }
    },
    async ({ version, count }) => {
      // 実際のロジック
      const uuids = [];
      for (let i = 0; i < count; i++) {
        uuids.push(generateUuid(version));
      }

      // 履歴に追加（リソースで参照可能に）
      uuidHistory.push(...);

      // MCP形式でレスポンスを返す
      return {
        content: [{ type: "text", text: `生成されたUUID: ${uuids.join(", ")}` }]
      };
    }
  );

  // 4.2 validate_uuid ツール
  server.registerTool("validate_uuid", { ... }, ...);

  // ========================================
  // 5. リソース登録
  // ========================================
  server.registerResource(
    "uuid-history",
    "uuid://history",
    { title: "UUID History", description: "...", mimeType: "application/json" },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: JSON.stringify({ history: uuidHistory })
      }]
    })
  );

  return server;
}
```

### 7.3 index.ts の詳細解説

```typescript
// ========================================
// 1. トランスポートのインポート
// ========================================
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// ========================================
// 2. コマンドライン引数解析
// ========================================
const args = process.argv.slice(2);
const useHttp = args.includes("--http");

// ========================================
// 3. stdio モード
// ========================================
async function startStdioServer() {
  const server = createUuidServer();

  // stdin/stdout を使うトランスポートを作成
  const transport = new StdioServerTransport();

  // サーバーとトランスポートを接続
  // → これでリクエストを受信・処理できるようになる
  await server.connect(transport);

  // 重要: stdoutはMCP通信に使用
  // ログはstderrに出力する
  console.error("Server started (stdio mode)");
}

// ========================================
// 4. HTTP モード
// ========================================
async function startHttpServer(port: number) {
  const app = express();

  // セッション管理用Map
  // HTTPはステートレスなので、サーバー側でセッションを管理
  const sessions = new Map();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];

    if (sessionId && sessions.has(sessionId)) {
      // 既存セッション: そのまま使用
      const transport = sessions.get(sessionId);
      await transport.handleRequest(req, res, req.body);
    }
    else if (isInitializeRequest(req.body)) {
      // 新規セッション: トランスポートとサーバーを作成
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, transport)
      });

      const server = createUuidServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    }
    else {
      // エラー: セッションなしで非initializeリクエスト
      res.status(400).json({ error: "Invalid session" });
    }
  });
}
```

### 7.4 重要な設計パターン

**パターン1: ロジックとトランスポートの分離**

```
createUuidServer()  ← ビジネスロジック（再利用可能）
        │
        ▼
┌───────────────────┐
│ stdio または HTTP │ ← トランスポート（入れ替え可能）
└───────────────────┘
```

**パターン2: セッション管理（HTTP）**

```typescript
// クライアントごとにセッションを管理
const sessions = new Map<string, StreamableHTTPServerTransport>();

// 初期化時にセッションIDを生成してクライアントに返す
// 以降のリクエストではヘッダーでセッションIDを指定
```

**パターン3: 状態の保持（リソース用）**

```typescript
// モジュールスコープで状態を保持
const uuidHistory = [];

// ツールで状態を更新
server.registerTool("generate_uuid", { ... }, async () => {
  uuidHistory.push(...);
});

// リソースで状態を公開
server.registerResource("uuid-history", "uuid://history", { ... }, async (uri) => {
  return { contents: [{ uri: uri.href, text: JSON.stringify(uuidHistory) }] };
});
```

---

## まとめ

### MCPの全体像

```
┌────────────────────────────────────────────────────────────────┐
│                        MCP Architecture                         │
│                                                                 │
│  ┌─────────────────┐                   ┌─────────────────────┐ │
│  │     Claude      │                   │    MCP Server       │ │
│  │   (AI Client)   │                   │                     │ │
│  │                 │   JSON-RPC 2.0    │  ┌───────────────┐  │ │
│  │  ・意図を解釈    │◄────────────────►│  │    Tools      │  │ │
│  │  ・ツールを選択   │    (stdio/HTTP)   │  │ generate_uuid │  │ │
│  │  ・結果を整理    │                   │  │ validate_uuid │  │ │
│  │                 │                   │  └───────────────┘  │ │
│  │                 │                   │  ┌───────────────┐  │ │
│  │                 │                   │  │   Resources   │  │ │
│  │                 │                   │  │ uuid://history│  │ │
│  │                 │                   │  └───────────────┘  │ │
│  └─────────────────┘                   └─────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### 学習のポイント

1. **MCP = JSON-RPC + トランスポート + Tool/Resource/Prompt**
2. **サーバーロジックはトランスポートに依存しない設計に**
3. **ツールの description はAIが選択する際の重要な情報**
4. **stdioはローカル向け、HTTPはリモート向け**
5. **HTTPモードではセッション管理が必要**

### 次のステップ

1. 新しいツールを追加してみる
2. リソースの動的生成を試す
3. プロンプトテンプレートを追加する
4. 認証機能を実装する（HTTPモード）
