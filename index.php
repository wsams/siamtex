<?php
declare(strict_types=1);
$base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/siamtex')), '/');
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SiamTeX</title>
  <meta name="description" content="Write and render LaTeX in the browser" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/codemirror.min.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/theme/material-darker.min.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/addon/dialog/dialog.min.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/addon/search/matchesonscrollbar.min.css" />
  <link rel="stylesheet" href="<?= htmlspecialchars($base, ENT_QUOTES) ?>/assets/app.css" />
</head>
<body>
  <div id="app">
    <header class="topbar">
      <div class="brand">
        <span class="logo">∫</span>
        <div>
          <strong>SiamTeX</strong>
          <span class="tag">LaTeX studio</span>
        </div>
      </div>
      <div class="top-actions" id="topActions"></div>
    </header>
    <main id="main"></main>
    <div id="toast" class="toast hidden" role="status"></div>
  </div>
  <script>
    window.SIAMTEX_BASE = <?= json_encode($base, JSON_THROW_ON_ERROR) ?>;
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/codemirror.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/mode/stex/stex.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/addon/edit/matchbrackets.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/addon/edit/closebrackets.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/addon/selection/active-line.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/addon/search/searchcursor.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/addon/search/search.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/addon/dialog/dialog.min.js"></script>
  <script src="<?= htmlspecialchars($base, ENT_QUOTES) ?>/assets/app.js"></script>
</body>
</html>
