document.addEventListener('DOMContentLoaded', () => {
    const trafficLanesContainer = document.getElementById('traffic-lanes-container');
    const firewallZoneElement = document.getElementById('firewall-zone');
    const whitelistModeButton = document.getElementById('whitelist-mode');
    const blacklistModeButton = document.getElementById('blacklist-mode');
    const resetButton = document.getElementById('reset-button');
    const modeDisplay = document.getElementById('mode-display');
    const dangerLevelProgress = document.getElementById('danger-level');
    const dangerValueSpan = document.getElementById('danger-value');
    const stressLevelProgress = document.getElementById('stress-level');
    const stressValueSpan = document.getElementById('stress-value');
    const messageArea = document.getElementById('message-area');
    const modeSelectionPanel = document.getElementById('mode-selection-panel'); // モード選択パネル

    // ゲームリザルト画面の要素
    const gameResultOverlay = document.getElementById('game-result-overlay');
    const resultTitle = document.getElementById('result-title');
    const resultFinalStatus = document.getElementById('result-final-status');
    const finalDangerValue = document.getElementById('final-danger-value');
    const finalStressValue = document.getElementById('final-stress-value');
    const analysisText = document.getElementById('analysis-text');
    const restartGameFromResultButton = document.getElementById('restart-game-from-result');

    let currentMode = null; // 'whitelist' or 'blacklist'
    let danger = 0;
    let stress = 0;
    const maxDanger = 100;
    const maxStress = 100;
    const totalMoveDuration = 10000; // 左端から右端まで10秒 (ms)
    
    // network-path の幅に対するファイアウォールゾーンの開始・終了位置の割合
    const firewallZoneStartRatio = 0.3; // network-pathの開始からfirewall-zoneが始まる位置
    const firewallZoneEndRatio = 0.7;   // network-pathの開始からfirewall-zoneが終わる位置

    // アイコン生成間隔の初期値とゲーム時間の変数
    let iconGenerationInterval = 1500; // 初期生成間隔 (ms)
    let iconGenerationIntervalId; // setInterval ID
    const GAME_DURATION = 60; // ゲーム時間 (秒)
    let gameTimerId; // ゲームタイマーのID
    let gameTimeRemaining = GAME_DURATION; // 残り時間
    
    const NUMBER_OF_LANES = 5; // レーンの数
    let gameActive = false;

    // IPアドレスのマップ (闇落ち機能は削除)
    const ipStates = {}; // { '192.168.1.1': { type: 'white'/'black' } }
    const NEW_BLACK_IP_CHANCE = 0.3; // 新規IPが黒になる確率

    // レーンのDOM要素を格納
    const lanes = [];

    // IPアドレス生成のためのヘルパー関数
    function generateRandomIp() {
        return Array(4).fill(0).map(() => Math.floor(Math.random() * 255)).join('.');
    }

    // レーンの初期化
    function setupLanes() {
        trafficLanesContainer.innerHTML = '';
        lanes.length = 0; // 配列をクリア
        for (let i = 0; i < NUMBER_OF_LANES; i++) {
            const lane = document.createElement('div');
            lane.classList.add('lane');
            trafficLanesContainer.appendChild(lane);
            lanes.push(lane);
        }
    }

    // アイコン生成関数
    function createIcon() {
        if (!gameActive) return;

        const icon = document.createElement('div');
        icon.classList.add('icon');
        
        let ipAddress = generateRandomIp();
        let isBlack = Math.random() < NEW_BLACK_IP_CHANCE; // 最初は黒アイコンの確率

        // 既存IPの場合、過去の色を維持
        if (!ipStates[ipAddress]) {
            ipStates[ipAddress] = { type: isBlack ? 'black' : 'white' };
        } else {
            isBlack = ipStates[ipAddress].type === 'black'; 
        }

        icon.classList.add(isBlack ? 'black' : 'white');

        // モードに応じた初期の縁色を設定
        if (currentMode === 'whitelist') {
            icon.classList.add('red-border'); // ホワイトリストは初期赤枠 (デフォルト拒否)
        } else if (currentMode === 'blacklist') {
            icon.classList.add('green-border'); // ブラックリストは初期緑枠 (デフォルト許可)
        }

        const ipSpan = document.createElement('span');
        ipSpan.classList.add('ip');
        ipSpan.textContent = ipAddress;
        icon.appendChild(ipSpan);
        icon.dataset.ip = ipAddress;
        icon.dataset.isBlack = isBlack.toString(); // "true" or "false"
        icon.dataset.isHandled = 'false'; // 処理済みかどうか (クリックされたか)
        // isApprovedはクリック操作で変わるため、初期状態はモードのデフォルト挙動に合わせる
        icon.dataset.isApproved = currentMode === 'blacklist' ? 'true' : 'false'; 

        // ランダムなレーンにアイコンを追加
        const targetLane = lanes[Math.floor(Math.random() * NUMBER_OF_LANES)];
        targetLane.appendChild(icon);

        // アニメーション開始
        icon.style.animation = `moveAcrossPath ${totalMoveDuration / 1000}s linear forwards`;

        // アイコンクリックイベント
        icon.addEventListener('click', () => handleIconClick(icon));

        // 通過判定ロジック
        const checkPassageInterval = setInterval(() => {
            if (!gameActive || !icon.parentNode || icon.dataset.isFinalized === 'true') { 
                clearInterval(checkPassageInterval);
                return;
            }

            const iconRect = icon.getBoundingClientRect();
            const containerRect = trafficLanesContainer.getBoundingClientRect();
            
            const iconFrontEdgeRelativeLeft = iconRect.left - containerRect.left;
            const laneTotalWidth = containerRect.width;

            const firewallZoneStartPx = laneTotalWidth * firewallZoneStartRatio;
            const firewallZoneEndPx = laneTotalWidth * firewallZoneEndRatio;
            const pathRightEdgePx = laneTotalWidth + iconRect.width / 2; // アイコンの中心がパスの右端を越える位置

            const isHandled = icon.dataset.isHandled === 'true'; 
            const isApproved = icon.dataset.isApproved === 'true'; // 現在のアイコンの許可状態

            // ファイアウォールゾーンの右端を通過した時点での判定
            if (iconFrontEdgeRelativeLeft >= firewallZoneEndPx) {
                // ここで初めて最終判定を行う (複数回実行されないようにisFinalizedフラグを設定)
                icon.dataset.isFinalized = 'true'; 
                handleFinalJudgment(icon, isApproved, isHandled); 
                clearInterval(checkPassageInterval); // 判定後は監視を停止
            } else if (iconFrontEdgeRelativeLeft >= pathRightEdgePx) {
                // パス全体を通過して右端に到達
                clearInterval(checkPassageInterval);
                if (icon.parentNode) icon.remove(); // 最終的に削除
            }
        }, 50); // 50msごとにチェック
    }

    // アイコンがクリックされたときの処理
    function handleIconClick(icon) {
        if (!gameActive) return;

        const isWhite = icon.classList.contains('white');
        const isBlack = icon.classList.contains('black');
        
        // 既にファイナライズ済み（ファイアウォールゾーン通過済み）は操作不可
        if (icon.dataset.isFinalized === 'true') {
            messageArea.textContent = `IP ${icon.dataset.ip} は既にファイアウォールを通過しました。`;
            return;
        }

        // ファイアウォールゾーン内でのクリックのみ有効化
        const iconRect = icon.getBoundingClientRect();
        const firewallZoneRect = firewallZoneElement.getBoundingClientRect();

        const iconCenterInZone = (iconRect.left + iconRect.width / 2) > firewallZoneRect.left && 
                                 (iconRect.left + iconRect.width / 2) < firewallZoneRect.right;
        
        if (!iconCenterInZone) {
            messageArea.textContent = `IP ${icon.dataset.ip} はファイアウォールゾーン外です。`;
            return;
        }

        icon.dataset.isHandled = 'true'; // クリックされたことをマーク
        messageArea.textContent = ''; // メッセージをクリア

        let newIsApproved;

        if (currentMode === 'whitelist') {
            // ホワイトリスト方式: クリックすると赤 -> 緑 に変化
            newIsApproved = true; // クリックで許可状態に
            icon.classList.add('green-border');
            icon.classList.remove('red-border');
            messageArea.textContent = `IP ${icon.dataset.ip} (白色) を許可しました。`;
        } else if (currentMode === 'blacklist') {
            // ブラックリスト方式: クリックすると緑 -> 赤 に変化
            newIsApproved = false; // クリックで拒否状態に
            icon.classList.add('red-border');
            icon.classList.remove('green-border');
            messageArea.textContent = `IP ${icon.dataset.ip} (黒色) を遮断しました。`;
        }
        icon.dataset.isApproved = newIsApproved.toString(); // 許可状態をデータ属性に保存

        updateStatus();
    }

    // ファイアウォールゾーンを通過した時点での最終判定ロジック
    function handleFinalJudgment(icon, isApproved, isHandled) { // isHandledを追加
        if (!gameActive || icon.dataset.isFinalized !== 'true') return;

        const isInitialBlack = icon.dataset.isBlack === 'true'; // 元々黒いアイコンか
        
        messageArea.textContent = ''; // メッセージをクリア

        if (isApproved === true) { // 緑枠（許可状態）で通過した場合
            if (isInitialBlack === true) {
                // 問題のある通信 (黒) が許可された -> サーバー危険度増加
                danger += 20;
                messageArea.textContent = `危険！IP ${icon.dataset.ip} (黒色) がサーバーに侵入しました！ (サーバー危険度増加)`;
                icon.classList.add('red-border'); // 通過だが危険なので赤縁
            } else {
                // 問題ない通信 (白) が許可された -> 成功
                messageArea.textContent = `IP ${icon.dataset.ip} (白色) がサーバーへ通過しました。`;
                icon.classList.add('green-border'); // 許可されたので緑縁
            }
        } else { // 赤枠（遮断状態）で通過した場合 (消滅が意図された状態)
            if (isInitialBlack === true) {
                // 問題のある通信 (黒) が拒否された -> 成功
                messageArea.textContent = `IP ${icon.dataset.ip} (黒色) を拒否しました。`;
                icon.classList.add('red-border'); // 拒否されたので赤縁
                destroyIconInstantly(icon); // 拒否されたので消滅
            } else {
                // 問題ない通信 (白) が拒否された -> ユーザーストレス増加
                stress += 20;
                messageArea.textContent = `エラー！IP ${icon.dataset.ip} (白色) を誤って拒否しました！ (ユーザーストレス増加)`;
                icon.classList.add('red-border'); // ストレスなので赤縁
                destroyIconInstantly(icon); // 拒否されたので消滅
            }
        }
        updateStatus();
    }

    // アイコンを即座に消滅させる (遮断時など)
    function destroyIconInstantly(icon) {
        if (icon && icon.parentNode) {
            icon.style.animationPlayState = 'paused'; // アニメーション停止
            icon.style.transition = 'opacity 0.3s ease-out';
            icon.style.opacity = '0';
            icon.addEventListener('transitionend', () => {
                icon.remove();
            }, { once: true });
        }
    }

    // ステータスバー更新
    function updateStatus() {
        danger = Math.max(0, Math.min(danger, maxDanger)); // 0-100の範囲に収める
        stress = Math.max(0, Math.min(stress, maxStress));

        dangerLevelProgress.value = danger;
        dangerValueSpan.textContent = `${danger} / ${maxDanger}`;
        stressLevelProgress.value = stress;
        stressValueSpan.textContent = `${stress} / ${maxStress}`;

        if (danger >= maxDanger || stress >= maxStress) {
            endGame(danger >= maxDanger ? 'サーバー危険度' : 'ユーザーストレス');
        }
    }

    // ゲーム開始（モード選択後に呼ばれる）
    function startGame() {
        if (gameActive) return;

        resetGameVariables();
        gameActive = true;

        modeSelectionPanel.classList.add('hidden'); // モード選択パネルを非表示に
        
        messageArea.textContent = `ゲーム開始！残り時間: ${gameTimeRemaining}秒`;

        trafficLanesContainer.innerHTML = ''; // 既存のアイコンをクリア
        setupLanes(); // レーンを再セットアップ
        
        // アイコン生成開始
        iconGenerationIntervalId = setInterval(createIcon, iconGenerationInterval);
        createIcon(); // 最初のアイコンをすぐに生成

        // ゲームタイマー開始
        gameTimerId = setInterval(() => {
            gameTimeRemaining--;
            if (gameTimeRemaining <= 0) {
                endGame('時間切れ');
            } else {
                messageArea.textContent = `ゲーム中！残り時間: ${gameTimeRemaining}秒`;
                // 後半にかけてトラフィック量を増やす
                if (gameTimeRemaining <= GAME_DURATION / 2 && iconGenerationInterval > 500) { // 半分過ぎたら間隔を狭める
                    clearInterval(iconGenerationIntervalId);
                    iconGenerationInterval = Math.max(500, iconGenerationInterval - 100); // 最低500ms
                    iconGenerationIntervalId = setInterval(createIcon, iconGenerationInterval);
                    messageArea.textContent += ' (トラフィック増加中!)';
                }
            }
        }, 1000); // 1秒ごとに更新
    }

    // ゲーム終了
    function endGame(reason) {
        gameActive = false;
        clearInterval(iconGenerationIntervalId);
        clearInterval(gameTimerId); // ゲームタイマーも停止
        
        // レーン上の残りのアイコンも停止・削除
        trafficLanesContainer.querySelectorAll('.icon').forEach(icon => {
            icon.style.animationPlayState = 'paused';
            icon.remove(); // 全て削除
        });

        messageArea.textContent = `ゲーム終了！${reason}が限界に達しました。`;
        
        // ゲームリザルト画面の表示
        showGameResult(reason);
    }

    // ゲームリザルト画面を表示する関数
    function showGameResult(reason) {
        gameResultOverlay.style.display = 'flex'; // オーバーレイを表示

        if (reason === '時間切れ') {
            resultTitle.textContent = 'タイムアップ！';
            resultFinalStatus.textContent = '制限時間内に目標達成！';
            resultFinalStatus.style.color = '#28a745'; // 緑色
        } else {
            resultTitle.textContent = 'ゲームオーバー！';
            resultFinalStatus.textContent = reason + 'が限界に達しました。';
            resultFinalStatus.style.color = '#dc3545'; // 赤色
        }
        
        finalDangerValue.textContent = `${danger} / ${maxDanger}`;
        finalStressValue.textContent = `${stress} / ${maxStress}`;

        // リザルト分析テキストの生成
        let analysis = '';
        if (currentMode === 'whitelist') {
            analysis += '<strong>【ホワイトリスト方式の結果分析】</strong><br>';
            analysis += 'この方式は、**「許可するものを明確に定義し、それ以外は全て拒否する」**という考え方です。<br>';
            analysis += 'デフォルトで拒否するため、未知の脅威に対する防御力が高いですが、新しい正当なアクセスを許可し忘れると、ユーザーストレスが増加しやすい特徴があります。<br><br>';
            if (danger === 0 && stress === 0) {
                analysis += '<strong>素晴らしい！</strong> サーバー危険度もユーザーストレスもゼロに抑え、完璧なファイアウォール運用でした！これがホワイトリスト方式の理想形です。';
            } else if (danger > 0 && stress === 0) {
                analysis += `サーバー危険度 (${danger}%) が上昇しています。<strong>黒い通信の許可ミス</strong>があったようです。この方式では、許可する通信を厳選することが非常に重要です。`;
            } else if (stress > 0 && danger === 0) {
                analysis += `ユーザーストレス (${stress}%) が上昇しています。<strong>白い通信の拒否ミス</strong>や、処理の遅れがあったようです。ホワイトリストでは、正当な通信を迅速に許可するバランスが求められます。`;
            } else {
                analysis += `サーバー危険度 (${danger}%) とユーザーストレス (${stress}%) の両方が上昇しています。ホワイトリスト方式の運用は、許可する通信の定義と迅速な判断が難しかったようです。`;
            }
        } else if (currentMode === 'blacklist') {
            analysis += '<strong>【ブラックリスト方式の結果分析】</strong><br>';
            analysis += 'この方式は、**「デフォルトで全て許可し、危険なものだけを拒否する」**という考え方です。<br>';
            analysis += '利便性が高く、多くのユーザーがスムーズにアクセスできますが、新しい不正なアクセスを見逃すと、サーバーが危険に晒されるリスクがあります。<br><br>';
            if (danger === 0 && stress === 0) {
                analysis += '<strong>素晴らしい！</strong> サーバー危険度もユーザーストレスもゼロに抑え、完璧なファイアウォール運用でした！これがブラックリスト方式の理想形です。';
            } else if (danger > 0 && stress === 0) {
                analysis += `サーバー危険度 (${danger}%) が上昇しています。<strong>黒い通信のブロックミス</strong>があったようです。この方式では、常に新しい脅威を検知し、リストに追加していく努力が必要です。`;
            } else if (stress > 0 && danger === 0) {
                analysis += `ユーザーストレス (${stress}%) が上昇しています。<strong>白い通信のブロックミス</strong>があったようです。ブラックリスト方式でも、誤って正当な通信を拒否するとユーザーの不満に繋がります。`;
            } else {
                analysis += `サーバー危険度 (${danger}%) とユーザーストレス (${stress}%) の両方が上昇しています。ブラックリスト方式の運用は、危険な通信の見極めと、誤検知を避けるバランスが難しかったようです。`;
            }
        }
        analysisText.innerHTML = analysis;

        restartGameFromResultButton.addEventListener('click', () => {
            gameResultOverlay.style.display = 'none';
            resetGame(); // ゲーム全体をリセット
        });
    }

    // ゲーム変数のみリセット
    function resetGameVariables() {
        danger = 0;
        stress = 0;
        updateStatus();
        Object.keys(ipStates).forEach(ip => delete ipStates[ip]); // IP状態もリセット
        gameTimeRemaining = GAME_DURATION; // 時間リセット
        iconGenerationInterval = 1500; // 生成間隔を初期値に戻す
    }

    // ゲーム全体をリセット (モード選択に戻る)
    function resetGame() {
        resetGameVariables();
        clearInterval(iconGenerationIntervalId);
        clearInterval(gameTimerId); // タイマーもクリア
        gameActive = false;
        currentMode = null;
        
        modeDisplay.textContent = 'モードを選択してください。';
        messageArea.textContent = 'ゲームをリセットしました。';

        trafficLanesContainer.innerHTML = ''; // レーン上のアイコンをクリア
        setupLanes(); // レーンを再生成
        
        whitelistModeButton.disabled = false;
        blacklistModeButton.disabled = false;
        
        modeSelectionPanel.classList.remove('hidden'); // モード選択パネルを再表示
    }

    // --- イベントリスナー ---

    whitelistModeButton.addEventListener('click', () => {
        if (gameActive) return;
        currentMode = 'whitelist';
        modeDisplay.textContent = '現在のモード: ホワイトリスト方式 (許可リストにないものは拒否)';
        startGame();
    });

    blacklistModeButton.addEventListener('click', () => {
        if (gameActive) return;
        currentMode = 'blacklist';
        modeDisplay.textContent = '現在のモード: ブラックリスト方式 (禁止リストにないものは許可)';
        startGame();
    });

    resetButton.addEventListener('click', resetGame);

    // 初期状態
    resetGame(); // 初期化を呼び出すことで、レーンも設定される
});