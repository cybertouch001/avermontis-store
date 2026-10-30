/* Avermontis Admin: apply the saved light/dark choice before the first paint (no flash). */
(function(){ try { var t = localStorage.getItem('avmA.theme') || 'auto'; var dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); } catch(e){} })();
