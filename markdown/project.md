# RemGo開発計画書

## 1. プロジェクト概要

Windowsマシンをサーバー（計算リソース）として活用し、Mac等のクライアント端末からリモート操作することを前提とした、高効率な画像生成環境の構築。

## 2. コア・コンセプト

* **Decoupled UI (UIの分離):** ブラウザを閉じてもサーバー側のプロセスと生成状態を維持する。
* **Persistent State (状態の永続化):** 入力値、プロンプト、設定を常にDBまたはJSONに同期し、リロード時に復元する。
* **Multi-GPU Multi-Session:** 装着されている各GPUに対して独立したセッションを割り当て、並列作業を可能にする。

---

## 3. 開発ロードマップ

### フェーズ 1: リモートアクセスとネットワーク最適化

* **外部アクセスの許可:** `--listen` 引数のデフォルト有効化と、ファイアウォール設定の自動化。
* **静的IP/ホスト名対応:** Macから `http://windows-pc.local:7860` のような形式で安定してアクセスできる環境の整備。
* **アセットの軽量化:** プレビュー画像の圧縮転送設定（リモート環境でのUIレスポンス向上）。

### フェーズ 2: UI状態の永続化 (Auto-Save/Restore)

* **Backend Session Storeの構築:** * ユーザーがブラウザで入力した内容を、変更のたびにサーバー側の `session_config.json` に即時保存。
* **Frontend Hydration:**
* Gradioの `load` イベント時に、サーバーから前回終了時のパラメータを読み込み、UIに反映させる処理の実装。


* **History Manager:**
* 生成履歴だけでなく、その時の「設定セット」をワンクリックで復元できるプリセット機能の強化。



### フェーズ 3: マルチGPUセッション管理

* **GPUインスタンス・マネージャー:**
* システム上の全GPU（CUDAデバイス）を検出し、デバイスIDごとに個別ポート（例: 7860, 7861...）でプロセスを立ち上げる管理UI。


* **リソース・スケジューリング:**
* 特定のセッションを特定のGPUに固定（Affinity設定）し、VRAMの競合を防止。


* **統合ダッシュボード:**
* 各GPUの稼働状況（使用率・温度・生成進捗）を一つの画面で監視できるモニタリング機能。



---

## 4. 技術スタックの変更点

| 機能 | 現状 (Fooocus) | 変更案 |
| --- | --- | --- |
| **UI Framework** | Gradio (Standard) | Gradio + Custom JavaScript (Local Storage連携) |
| **State Management** | Memory-based | SQLite または JSON-based Store |
| **GPU Dispatch** | Single instance | Multi-process wrapper (Python Subprocess管理) |
| **Remote Access** | Optional | Default enabled with Basic Auth (セキュリティ確保) |

---

## 5. 実装上の注意点

1. **Gradioの制約:** Gradioはステートフルな設計が難しいため、ブラウザ側（JavaScript）での値の保持と、サーバー側APIの叩き分けが必要になります。
2. **VRAM管理:** マルチセッション化する際、共有モデル（Base Model等）のメモリ重複ロードを避けるための共有メモリ設計、あるいは明確なGPU分離が必要です。
3. **ファイルパス:** WindowsとMacではパスの記法が異なります。パス操作は必ず `pathlib` を使用し、OSに依存しない実装を徹底してください。
