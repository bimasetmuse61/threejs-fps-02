// The DOM HUD: health, ammo, timer, score, money, alive counts, kill feed,
// plant progress, the buy menu and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads the play callback out. Every
// setter is guarded so the DOM is only written when a value actually changes.
const COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'Cinder Yard — a tactical round-based FPS. Plant the core at Silo or Depot, or eliminate the Ember team. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  matchWin: {
    title: 'Match won',
    copy: 'Vanguard takes Cinder Yard.',
    action: 'Play again',
  },
  matchLose: {
    title: 'Match lost',
    copy: 'Ember holds Cinder Yard.',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const healthNum = $('health-num');
  const healthFill = $('health-fill');
  const timerEl = $('timer');
  const scoreEl = $('round-score');
  const phaseEl = $('phase-label');
  const moneyEl = $('money');
  const pipsV = $('pips-vanguard');
  const pipsE = $('pips-ember');
  const killfeed = $('killfeed');
  const messageEl = $('message');
  const plantWrap = $('plant-wrap');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageFlash = $('damage-flash');
  const buyPanel = $('buy-panel');
  const buyMoney = $('buy-money');
  const spectate = $('spectate');
  const ammoBox = $('ammo');

  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastPhase = '';
  let lastPips = '';
  let hitTimer = 0;
  let messageTimer = 0;

  function pips(alive, total, team) {
    let html = '';
    for (let i = 0; i < total; i += 1) {
      html += `<i class="${i < alive ? 'alive' : 'dead'} ${team}"></i>`;
    }
    return html;
  }

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      weaponName.textContent = name;
    },
    setGrenades(count) {
      grenadeCount.textContent = count > 0 ? `◉ ${count}` : '—';
    },
    setHealth(health) {
      const value = Math.max(0, Math.ceil(health));
      if (value === lastHealth) return;
      lastHealth = value;
      healthNum.textContent = String(value);
      healthFill.style.width = `${value}%`;
      healthFill.classList.toggle('low', value <= 30);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyEl.textContent = `$${value.toLocaleString('en-US')}`;
      buyMoney.textContent = `$${value.toLocaleString('en-US')}`;
    },
    setTimer(seconds, label) {
      const text = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      if (text !== lastTimer || label !== lastPhase) {
        lastTimer = text;
        lastPhase = label;
        timerEl.textContent = text;
        phaseEl.textContent = label;
      }
    },
    setScore(vanguard, ember) {
      const text = `${vanguard} — ${ember}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreEl.textContent = text;
    },
    setAlive(vanguard, ember, vanguardTotal, emberTotal) {
      const key = `${vanguard}/${ember}`;
      if (key === lastPips) return;
      lastPips = key;
      pipsV.innerHTML = pips(vanguard, vanguardTotal, 'vanguard');
      pipsE.innerHTML = pips(ember, emberTotal, 'ember');
    },
    killFeed(killer, victim, weapon, headshot) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.textContent = `${killer}  ${headshot ? '☠' : '✕'}  ${victim} · ${weapon}`;
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => row.remove(), 5000);
    },
    message(text, holdMs = 2600) {
      messageEl.textContent = text;
      messageEl.classList.add('on');
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => messageEl.classList.remove('on'), holdMs);
    },
    showPlant(label, fraction) {
      plantWrap.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    hidePlant() {
      plantWrap.hidden = true;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageFlash.classList.add('on');
      setTimeout(() => damageFlash.classList.remove('on'), 180);
    },
    crosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    showBuy(open, money, rows) {
      buyPanel.hidden = !open;
      if (!open) return;
      buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
      const list = $('buy-list');
      list.innerHTML = '';
      for (const row of rows) {
        const div = document.createElement('div');
        div.className = `buy-row${row.owned ? ' owned' : ''}${row.affordable ? '' : ' poor'}`;
        div.innerHTML = `<span class="buy-key">${row.key}</span><span class="buy-name">${row.name}</span><span class="buy-detail">${row.detail}</span><span class="buy-price">${row.owned ? 'OWNED' : '$' + row.price.toLocaleString('en-US')}</span>`;
        list.appendChild(div);
      }
    },
    setSpectating(name) {
      if (name) {
        spectate.hidden = false;
        spectate.textContent = `Spectating ${name} — wait for the next round`;
      } else {
        spectate.hidden = true;
      }
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'matchWin' || mode === 'matchLose'
        ? `${text.copy} Final score ${score}.`
        : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
