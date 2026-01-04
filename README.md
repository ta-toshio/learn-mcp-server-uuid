# UUID MCP Server

MCP（Model Context Protocol）の学習用サーバーです。UUIDの生成・検証機能を通じて、MCPの基本構造を理解できます。

> 📚 **MCPの詳細な解説は [docs/MCP_GUIDE.md](docs/MCP_GUIDE.md) を参照してください。**
> アーキテクチャ、JSON-RPC通信、McpServerの内部処理などを詳しく解説しています。

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

## プロジェクト構造

```
uuid-mcp/
├── src/
│   ├── index.ts    # エントリーポイント（トランスポート選択）
│   └── server.ts   # MCPサーバーロジック（ツール・リソース定義）
├── docs/
│   └── MCP_GUIDE.md # MCP完全ガイド（詳細解説）
├── package.json
├── tsconfig.json
└── README.md
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

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [docs/MCP_GUIDE.md](docs/MCP_GUIDE.md) | MCP完全ガイド（アーキテクチャ、JSON-RPC、実装詳細） |

## ライセンス

MIT
