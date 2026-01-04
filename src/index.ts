#!/usr/bin/env node
/**
 * UUID MCP サーバー エントリーポイント
 *
 * このファイルは、MCPサーバーの起動ポイントです。
 * コマンドライン引数に応じて、以下の2つのトランスポートモードで動作します：
 *
 * 1. stdio モード（デフォルト）:
 *    - 標準入出力を通じてJSON-RPCメッセージをやり取り
 *    - Claude Desktop等のローカルアプリケーションから直接プロセスを起動する場合に使用
 *    - 例: node dist/index.js
 *
 * 2. HTTP モード（--http フラグ）:
 *    - HTTPエンドポイントを通じてJSON-RPCメッセージをやり取り
 *    - リモートクライアントやWebベースのクライアントからアクセスする場合に使用
 *    - 例: node dist/index.js --http
 *
 * MCP通信プロトコルの解説:
 * ==========================
 *
 * MCPは JSON-RPC 2.0 をベースにしたプロトコルです。
 *
 * リクエスト例（ツール呼び出し）:
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "generate_uuid",
 *     "arguments": { "version": "v4", "count": 1 }
 *   }
 * }
 *
 * レスポンス例:
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "result": {
 *     "content": [{ "type": "text", "text": "生成されたUUID: ..." }]
 *   }
 * }
 *
 * 通信の流れ:
 * 1. 初期化: クライアント → サーバー "initialize" リクエスト
 * 2. 機能確認: サーバーが対応するツール/リソースをレスポンス
 * 3. 操作: クライアントがツール実行やリソース読み取りをリクエスト
 * 4. 終了: クライアント → サーバー "shutdown" リクエスト
 */

import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { createUuidServer } from "./server.js";

/**
 * コマンドライン引数を解析して動作モードを決定
 */
const args = process.argv.slice(2);
const useHttp = args.includes("--http");
const port = Number.parseInt(
	args.find((arg) => arg.startsWith("--port="))?.split("=")[1] ?? "3000",
	10
);

/**
 * メイン関数
 * 引数に応じてstdioまたはHTTPモードでサーバーを起動
 */
async function main(): Promise<void> {
	if (useHttp) {
		await startHttpServer(port);
	} else {
		await startStdioServer();
	}
}

/**
 * stdio モードでサーバーを起動
 *
 * stdioトランスポートの仕組み:
 * - プロセスの標準入力(stdin)でJSONリクエストを受信
 * - 標準出力(stdout)でJSONレスポンスを送信
 * - 標準エラー(stderr)はログ出力に使用可能
 *
 * Claude Desktopとの連携:
 * Claude Desktopは設定に基づいてこのプロセスを起動し、
 * stdin/stdoutを通じて直接通信します。
 */
async function startStdioServer(): Promise<void> {
	// MCPサーバーインスタンスを作成
	const server = createUuidServer();

	// stdioトランスポートを作成
	// StdioServerTransportは、process.stdinとprocess.stdoutを使って
	// JSON-RPCメッセージをやり取りするクラスです
	const transport = new StdioServerTransport();

	// サーバーとトランスポートを接続
	// connect()を呼ぶと、トランスポートからのリクエストを
	// サーバーが処理できるようになります
	await server.connect(transport);

	// stderrにログを出力（stdoutはMCP通信に使用するため）
	console.error("UUID MCP Server started (stdio mode)");
}

/**
 * HTTP モードでサーバーを起動
 *
 * Streamable HTTPトランスポートの仕組み:
 * - POST /mcp: JSON-RPCリクエストを受信、レスポンスを返す
 * - GET /mcp: Server-Sent Events (SSE)でサーバーからの通知を受信
 * - DELETE /mcp: セッションを終了
 *
 * セッション管理:
 * - 各クライアントは初期化時にセッションIDを受け取る
 * - 以降のリクエストではヘッダー "mcp-session-id" でセッションを識別
 *
 * @param port 待ち受けポート番号
 */
async function startHttpServer(port: number): Promise<void> {
	const app = express();

	// JSONボディのパース
	app.use(express.json());

	// アクティブなセッションを管理するマップ
	// セッションID → トランスポートインスタンス
	const sessions: Map<string, StreamableHTTPServerTransport> = new Map();

	/**
	 * POST /mcp - JSON-RPCリクエストを処理
	 *
	 * クライアントからのリクエストを受け取り、処理して結果を返します。
	 * 初回リクエスト（initialize）では新しいセッションを作成し、
	 * 以降はセッションIDで既存のセッションを再利用します。
	 */
	app.post("/mcp", async (req, res) => {
		// ヘッダーからセッションIDを取得
		const sessionId = req.headers["mcp-session-id"] as string | undefined;
		let transport: StreamableHTTPServerTransport;

		if (sessionId && sessions.has(sessionId)) {
			// 既存セッションを再利用
			transport = sessions.get(sessionId)!;
		} else if (!sessionId && isInitializeRequest(req.body)) {
			// 新規セッションを作成（initializeリクエストの場合のみ）
			transport = new StreamableHTTPServerTransport({
				// セッションIDを生成する関数
				sessionIdGenerator: () => randomUUID(),
				// セッション初期化時のコールバック
				onsessioninitialized: (id) => {
					sessions.set(id, transport);
					console.log(`[HTTP] Session initialized: ${id}`);
				},
				// セッション終了時のコールバック
				onsessionclosed: (id) => {
					sessions.delete(id);
					console.log(`[HTTP] Session closed: ${id}`);
				},
			});

			// トランスポートのクローズ時にセッションをクリーンアップ
			transport.onclose = () => {
				if (transport.sessionId) {
					sessions.delete(transport.sessionId);
				}
			};

			// 新しいMCPサーバーインスタンスを作成して接続
			const server = createUuidServer();
			await server.connect(transport);
		} else {
			// 無効なリクエスト（セッションなしで非initializeリクエスト）
			res.status(400).json({
				jsonrpc: "2.0",
				error: {
					code: -32000,
					message: "Invalid session. Send initialize request first.",
				},
				id: null,
			});
			return;
		}

		// リクエストを処理
		await transport.handleRequest(req, res, req.body);
	});

	/**
	 * GET /mcp - Server-Sent Events (SSE) ストリーム
	 *
	 * サーバーからクライアントへの非同期通知を送信するためのエンドポイント。
	 * クライアントはこのエンドポイントに接続し、サーバーからのイベントを受信します。
	 */
	app.get("/mcp", async (req, res) => {
		const sessionId = req.headers["mcp-session-id"] as string;
		const transport = sessions.get(sessionId);

		if (transport) {
			await transport.handleRequest(req, res);
		} else {
			res.status(400).json({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Invalid session" },
				id: null,
			});
		}
	});

	/**
	 * DELETE /mcp - セッション終了
	 *
	 * クライアントがセッションを明示的に終了する場合に使用します。
	 */
	app.delete("/mcp", async (req, res) => {
		const sessionId = req.headers["mcp-session-id"] as string;
		const transport = sessions.get(sessionId);

		if (transport) {
			await transport.handleRequest(req, res);
		} else {
			res.status(400).json({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Invalid session" },
				id: null,
			});
		}
	});

	/**
	 * ヘルスチェックエンドポイント
	 */
	app.get("/health", (_req, res) => {
		res.json({
			status: "ok",
			server: "uuid-mcp",
			version: "1.0.0",
			activeSessions: sessions.size,
		});
	});

	// サーバーを起動
	app.listen(port, () => {
		console.log("UUID MCP Server started (HTTP mode)");
		console.log(`  MCP Endpoint: http://localhost:${port}/mcp`);
		console.log(`  Health Check: http://localhost:${port}/health`);
	});
}

// エントリーポイント実行
main().catch((error) => {
	console.error("Failed to start server:", error);
	process.exit(1);
});
