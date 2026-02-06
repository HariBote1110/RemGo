# Fooocus カスタムフォーク RemGo 開発計画書：Decoupledアーキテクチャ版

## 1. 新アーキテクチャ方針

Python側は画像生成のロジックとGPU制御に専念させ、ユーザーインターフェースは完全に独立したReactアプリケーションとして構築します。

---

## 2. 開発ロードマップ（改訂版）

### フェーズ 1: PythonバックエンドのAPI化 (FastAPI / Flask)

* **Gradioからの脱却:** 現在のUI定義を破棄し、FastAPI等でエンドポイント（`/generate`, `/status`, `/settings`）を構築。
* **WebSocketの実装:** 生成中のプレビュー画像や進捗率をリアルタイムでMac（ブラウザ）へ送信するため、双方向通信を導入。
* **Headlessモード:** UIを持たず、コマンドライン引数で指定されたGPUデバイス上でAPIサーバーとして待機する機能を実装。

### フェーズ 2: Reactフロントエンドの構築

* **State Management (Zustand / Redux):**
* ブラウザの `LocalStorage` または `IndexedDB` を活用。入力中のプロンプトやパラメータをリアルタイム保存。


* **Mac/iPad最適化:**
* レスポンシブデザインの採用と、Macのキーボードショートカット（Cmd+Enterでの生成など）への対応。


* **マルチセッション・インターフェース:**
* タブ切り替え形式で、Windows上の「GPU 0」と「GPU 1」の生成状況を同時に操作・監視できるダッシュボード。



### フェーズ 3: マルチGPU・オーケストレーション

* **Central Controller:**
* 各GPUプロセスを統括する軽量なマネージャー（Node.js または Python）を設置。
* フロントエンドからのリクエストを、空いているGPUセッションへルーティング。



---

## 3. 技術スタック案

| レイヤー | 技術 | 役割 |
| --- | --- | --- |
| **Frontend** | **React + Vite / Tailwind CSS** | 高速なUI、永続的なステート管理 |
| **API Backend** | **FastAPI (Python)** | Fooocusコアロジックの呼び出し、GPU制御 |
| **Communication** | **WebSockets** | 生成進捗のリアルタイム・フィードバック |
| **Process Mgmt** | **PM2** (or Custom script) | Windows上での複数Pythonプロセスの永続化 |

---

## 4. この構成のメリット

* **ステート保持の自由度:** ブラウザを閉じても、React側の状態管理ライブラリが値を保持しているため、再開が容易です。
* **低遅延:** Reactを使用することでUIの再描画が最小限になり、リモート（Mac）からの操作がネイティブアプリのように滑らかになります。
* **拡張性:** 将的にモバイル（iPhone/iPad）専用のUIを構築したり、APIを他の自作ツールから叩くことも可能になります。
