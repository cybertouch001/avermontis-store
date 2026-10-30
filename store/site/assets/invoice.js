/* Invoice page: the button opens the print dialog -> 'Save as PDF' on phones and computers. */
(function(){var b=document.getElementById('print-btn');if(b)b.addEventListener('click',function(){window.print();});if(/[?&]print=1\b/.test(location.search))setTimeout(function(){window.print();},400);})();
