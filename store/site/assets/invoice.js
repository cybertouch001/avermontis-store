/* Invoice page: the button opens the print dialog -> 'Save as PDF' on phones and computers.
   v6: inside the Avermontis Admin app the Android print service does it (Android WebViews ignore window.print). */
(function(){
var N = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AvmAdmin;
function pr(){ if (N && N.printPage) N.printPage({name: document.title || 'Avermontis invoice'}); else window.print(); }
var b=document.getElementById('print-btn');if(b)b.addEventListener('click',pr);
if(/[?&]print=1\b/.test(location.search))setTimeout(pr,400);
})();
