import { randomBytes, randomUUID } from "node:crypto";
/**
 * UUID MCP サーバーのコア実装
 *
 * このファイルでは、MCPサーバーの中核となるロジックを定義します。
 * ツールの登録やリソースの定義を行い、トランスポート層から独立した形で
 * サーバー機能を提供します。
 *
 * MCP（Model Context Protocol）の基本構造:
 * - Tools: AIが実行できるアクション（例: generate_uuid）
 * - Resources: AIが読み取れるデータ（例: uuid://history）
 * - Prompts: 定型のプロンプトテンプレート
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

/**
 * UUID生成履歴を保持する配列
 * リソース機能のデモンストレーションのため、セッション中に生成したUUIDを記録する
 */
const uuidHistory: Array<{ uuid: string; version: string; createdAt: string }> = [];

/**
 * MCPサーバーインスタンスを作成する
 *
 * @returns 設定済みのMcpServerインスタンス
 *
 * 解説:
 * McpServerは、ツール・リソース・プロンプトを登録し、
 * クライアント（Claude等）からのリクエストを処理するためのクラスです。
 * 実際の通信方法（stdio/HTTP）はトランスポート層が担当するため、
 * このサーバーロジックはトランスポートに依存しません。
 */
export function createUuidServer(): McpServer {
	const server = new McpServer({
		name: "uuid-mcp",
		version: "1.0.0",
	});

	/**
	 * ===== ツール登録 =====
	 *
	 * ツール（Tool）は、AIが実行できるアクションです。
	 * クライアント（Claude）が「このツールを実行してほしい」とリクエストすると、
	 * サーバーがツールを実行し、結果を返します。
	 *
	 * JSON-RPCの流れ:
	 * 1. クライアント → サーバー: tools/call リクエスト（引数付き）
	 * 2. サーバー: ツール関数を実行
	 * 3. サーバー → クライアント: 実行結果をレスポンス
	 */

	/**
	 * generate_uuid ツール
	 * UUIDを生成して返す基本的なツール
	 *
	 * 引数:
	 * - version: "v4" または "v7" を指定（デフォルト: "v4"）
	 * - count: 生成するUUIDの数（1-10、デフォルト: 1）
	 */
	server.registerTool(
		"generate_uuid",
		{
			title: "UUID Generator",
			description:
				"UUIDを生成します。v4（ランダム）またはv7（タイムスタンプベース）を選択できます。",
			inputSchema: {
				version: z
					.enum(["v4", "v7"])
					.default("v4")
					.describe("UUIDのバージョン。v4はランダム、v7はタイムスタンプベース"),
				count: z.number().min(1).max(10).default(1).describe("生成するUUIDの数（1-10）"),
			},
		},
		async ({ version, count }) => {
			const uuids: string[] = [];

			for (let i = 0; i < count; i++) {
				let uuid: string;

				if (version === "v7") {
					// UUID v7: タイムスタンプ + ランダム
					// RFC 9562で定義された新しいUUID形式
					uuid = generateUuidV7();
				} else {
					// UUID v4: 完全ランダム
					// Node.jsのcrypto.randomUUID()を使用
					uuid = randomUUID();
				}

				uuids.push(uuid);

				// 履歴に追加（リソース機能のデモ用）
				uuidHistory.push({
					uuid,
					version,
					createdAt: new Date().toISOString(),
				});
			}

			// 履歴が100件を超えたら古いものを削除
			while (uuidHistory.length > 100) {
				uuidHistory.shift();
			}

			return {
				content: [
					{
						type: "text",
						text:
							count === 1
								? `生成されたUUID (${version}): ${uuids[0]}`
								: `生成されたUUID (${version}):\n${uuids.map((u, i) => `${i + 1}. ${u}`).join("\n")}`,
					},
				],
			};
		}
	);

	/**
	 * validate_uuid ツール
	 * 与えられた文字列が有効なUUIDかどうかを検証する
	 */
	server.registerTool(
		"validate_uuid",
		{
			title: "UUID Validator",
			description: "文字列が有効なUUID形式かどうかを検証します。",
			inputSchema: {
				uuid: z.string().describe("検証するUUID文字列"),
			},
		},
		async ({ uuid }) => {
			// UUIDの正規表現パターン
			const uuidPattern =
				/^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
			const isValid = uuidPattern.test(uuid);

			let version: string | null = null;
			if (isValid) {
				// UUIDのバージョンを特定（13文字目）
				const versionChar = uuid[14];
				if (versionChar) {
					version = `v${versionChar}`;
				}
			}

			return {
				content: [
					{
						type: "text",
						text: isValid
							? `✅ 有効なUUIDです（バージョン: ${version}）`
							: `❌ 無効なUUID形式です: ${uuid}`,
					},
				],
			};
		}
	);

	/**
	 * ===== リソース登録 =====
	 *
	 * リソース（Resource）は、AIが読み取れるデータです。
	 * ファイルやデータベースのように、URIでアクセス可能なデータを提供します。
	 *
	 * JSON-RPCの流れ:
	 * 1. クライアント → サーバー: resources/read リクエスト（URI指定）
	 * 2. サーバー: リソースデータを取得
	 * 3. サーバー → クライアント: データをレスポンス
	 */

	/**
	 * uuid://history リソース
	 * セッション中に生成したUUIDの履歴を提供する
	 */
	server.registerResource(
		"uuid-history",
		"uuid://history",
		{
			title: "UUID History",
			description: "セッション中に生成されたUUIDの履歴",
			mimeType: "application/json",
		},
		async (uri) => {
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(
							{
								totalCount: uuidHistory.length,
								history: uuidHistory.slice(-20), // 最新20件を返す
							},
							null,
							2
						),
					},
				],
			};
		}
	);

	return server;
}

/**
 * UUID v7を生成する
 *
 * UUID v7はRFC 9562で定義された新しいUUID形式で、
 * タイムスタンプをベースにしているため時系列でソート可能です。
 *
 * 構造（128ビット）:
 * - 48ビット: UNIXタイムスタンプ（ミリ秒）
 * - 4ビット: バージョン（0111 = 7）
 * - 12ビット: ランダムまたはシーケンス
 * - 2ビット: バリアント（10）
 * - 62ビット: ランダム
 *
 * @returns UUID v7形式の文字列
 */
function generateUuidV7(): string {
	const timestamp = Date.now();

	// 16バイトのバッファを作成
	const bytes = new Uint8Array(16);

	// タイムスタンプを先頭6バイトに格納（ビッグエンディアン）
	bytes[0] = (timestamp / 2 ** 40) & 0xff;
	bytes[1] = (timestamp / 2 ** 32) & 0xff;
	bytes[2] = (timestamp / 2 ** 24) & 0xff;
	bytes[3] = (timestamp / 2 ** 16) & 0xff;
	bytes[4] = (timestamp / 2 ** 8) & 0xff;
	bytes[5] = timestamp & 0xff;

	// 残りをランダムバイトで埋める
	const randomPart = randomBytes(10);
	bytes.set(randomPart, 6);

	// バージョン（7）を設定: 7番目のバイトの上位4ビット
	bytes[6] = (bytes[6]! & 0x0f) | 0x70;

	// バリアント（RFC 4122）を設定: 9番目のバイトの上位2ビット
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;

	// 16進数文字列に変換してUUID形式にフォーマット
	const hex = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
