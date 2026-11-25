import { runGame } from './game/game';

runGame().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;background:#200;padding:16px;position:fixed;top:0;left:0;z-index:999999">${String(err)}</pre>`);
});
