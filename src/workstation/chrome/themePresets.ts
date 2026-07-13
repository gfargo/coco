/**
 * Theme color-preset data table, extracted from `theme.ts` (#1640) — that
 * file dwarfed its own resolver logic with this ~128-entry catalog, so every
 * theme addition churned a module that also owns behavior. This file is
 * data only; `theme.ts` re-exports `THEME_PRESET_COLORS` from here so every
 * existing import site keeps working unchanged.
 *
 * AGENTS.md's theme rule: adding a theme = one entry here (+ a synced
 * screenshot). The CLI choices, screenshot carousel, and `.www` are all
 * derived from this table.
 */

import type { LogInkThemeColors, LogInkThemePreset } from './theme'

export const THEME_PRESET_COLORS: Record<Exclude<LogInkThemePreset, 'monochrome'>, LogInkThemeColors> = {
  /**
   * coco default — coco contributors
   * @see https://github.com/gfargo/coco
   */
  default: {
    accent: 'cyan',
    border: 'gray',
    danger: 'red',
    focusBorder: 'cyan',
    gitAdded: 'green',
    gitDeleted: 'red',
    gitModified: 'yellow',
    info: 'blue',
    muted: 'gray',
    selection: '#1a3a4a',
    success: 'green',
    warning: 'yellow',
  },
  /**
   * Catppuccin (Mocha) — Catppuccin Org
   * @see https://github.com/catppuccin/catppuccin
   */
  catppuccin: {
    accent: '#89b4fa',
    border: '#585b70',
    danger: '#f38ba8',
    focusBorder: '#89dceb',
    gitAdded: '#a6e3a1',
    gitDeleted: '#f38ba8',
    gitModified: '#f9e2af',
    info: '#89b4fa',
    muted: '#6c7086',
    selection: '#45475a',
    success: '#a6e3a1',
    warning: '#f9e2af',
  },
  /**
   * Gruvbox — Pavel Pertsev
   * @see https://github.com/morhetz/gruvbox
   */
  gruvbox: {
    accent: '#83a598',
    border: '#665c54',
    danger: '#fb4934',
    focusBorder: '#8ec07c',
    gitAdded: '#b8bb26',
    gitDeleted: '#fb4934',
    gitModified: '#fabd2f',
    info: '#83a598',
    muted: '#928374',
    selection: '#504945',
    success: '#b8bb26',
    warning: '#fabd2f',
  },
  /**
   * Dracula — Zeno Rocha
   * @see https://github.com/dracula/dracula-theme
   */
  dracula: {
    accent: '#bd93f9',
    border: '#44475a',
    danger: '#ff5555',
    focusBorder: '#ff79c6',
    gitAdded: '#50fa7b',
    gitDeleted: '#ff5555',
    gitModified: '#f1fa8c',
    info: '#8be9fd',
    muted: '#6272a4',
    selection: '#44475a',
    success: '#50fa7b',
    warning: '#f1fa8c',
  },
  /**
   * Nord — Arctic Ice Studio
   * @see https://github.com/nordtheme/nord
   */
  nord: {
    accent: '#88c0d0',
    border: '#3b4252',
    danger: '#bf616a',
    focusBorder: '#81a1c1',
    gitAdded: '#a3be8c',
    gitDeleted: '#bf616a',
    gitModified: '#ebcb8b',
    info: '#81a1c1',
    muted: '#4c566a',
    selection: '#3b4252',
    success: '#a3be8c',
    warning: '#ebcb8b',
  },
  /**
   * Solarized Dark — Ethan Schoonover
   * @see https://github.com/altercation/solarized
   */
  'solarized-dark': {
    accent: '#268bd2',
    border: '#073642',
    danger: '#dc322f',
    focusBorder: '#2aa198',
    gitAdded: '#859900',
    gitDeleted: '#dc322f',
    gitModified: '#b58900',
    info: '#268bd2',
    muted: '#586e75',
    selection: '#073642',
    success: '#859900',
    warning: '#b58900',
  },
  /**
   * Tokyo Night — Enkia
   * @see https://github.com/enkia/tokyo-night-vscode-theme
   */
  'tokyo-night': {
    accent: '#7aa2f7',
    border: '#3b4261',
    danger: '#f7768e',
    focusBorder: '#7dcfff',
    gitAdded: '#9ece6a',
    gitDeleted: '#f7768e',
    gitModified: '#e0af68',
    info: '#7aa2f7',
    muted: '#565f89',
    selection: '#33467c',
    success: '#9ece6a',
    warning: '#e0af68',
  },
  /**
   * One Dark Pro — Bram de Haan
   * @see https://github.com/Binaryify/OneDark-Pro
   */
  'one-dark': {
    accent: '#61afef',
    border: '#3e4452',
    danger: '#e06c75',
    focusBorder: '#56b6c2',
    gitAdded: '#98c379',
    gitDeleted: '#e06c75',
    gitModified: '#e5c07b',
    info: '#61afef',
    muted: '#5c6370',
    selection: '#3e4452',
    success: '#98c379',
    warning: '#e5c07b',
  },
  /**
   * Rosé Pine (Main) — Rosé Pine team
   * @see https://github.com/rose-pine/rose-pine-theme
   */
  'rose-pine': {
    accent: '#c4a7e7',
    border: '#26233a',
    danger: '#eb6f92',
    focusBorder: '#9ccfd8',
    gitAdded: '#31748f',
    gitDeleted: '#eb6f92',
    gitModified: '#f6c177',
    info: '#9ccfd8',
    muted: '#6e6a86',
    selection: '#2a273f',
    success: '#31748f',
    warning: '#f6c177',
  },
  /**
   * Kanagawa — rebelot
   * @see https://github.com/rebelot/kanagawa.nvim
   */
  kanagawa: {
    accent: '#7e9cd8',
    border: '#2a2a37',
    danger: '#e82424',
    focusBorder: '#7fb4ca',
    gitAdded: '#76946a',
    gitDeleted: '#e82424',
    gitModified: '#dca561',
    info: '#7e9cd8',
    muted: '#727169',
    selection: '#2d4f67',
    success: '#76946a',
    warning: '#dca561',
  },
  /**
   * Everforest — sainnhe
   * @see https://github.com/sainnhe/everforest
   */
  everforest: {
    accent: '#a7c080',
    border: '#374145',
    danger: '#e67e80',
    focusBorder: '#83c092',
    gitAdded: '#a7c080',
    gitDeleted: '#e67e80',
    gitModified: '#dbbc7f',
    info: '#7fbbb3',
    muted: '#859289',
    selection: '#374145',
    success: '#a7c080',
    warning: '#dbbc7f',
  },
  /**
   * Monokai — Wimer Hazenberg
   * @see https://monokai.pro
   */
  monokai: {
    accent: '#66d9ef',
    border: '#49483e',
    danger: '#f92672',
    focusBorder: '#a6e22e',
    gitAdded: '#a6e22e',
    gitDeleted: '#f92672',
    gitModified: '#e6db74',
    info: '#66d9ef',
    muted: '#75715e',
    selection: '#49483e',
    success: '#a6e22e',
    warning: '#e6db74',
  },
  /**
   * SynthWave '84 — Robb Owen
   * @see https://github.com/robb0wen/synthwave-vscode
   */
  synthwave: {
    accent: '#f97e72',
    border: '#34294f',
    danger: '#fe4450',
    focusBorder: '#36f9f6',
    gitAdded: '#72f1b8',
    gitDeleted: '#fe4450',
    gitModified: '#fede5d',
    info: '#36f9f6',
    muted: '#848bbd',
    selection: '#34294f',
    success: '#72f1b8',
    warning: '#fede5d',
  },
  /**
   * Ayu Dark — Ike Ku
   * @see https://github.com/dempfi/ayu
   */
  'ayu-dark': {
    accent: '#e6b450',
    border: '#11151c',
    danger: '#f07178',
    focusBorder: '#39bae6',
    gitAdded: '#7fd962',
    gitDeleted: '#f07178',
    gitModified: '#e6b450',
    info: '#39bae6',
    muted: '#565b66',
    selection: '#1a1f29',
    success: '#7fd962',
    warning: '#e6b450',
  },
  /**
   * Palenight — whizkydee
   * @see https://github.com/whizkydee/vscode-palenight-theme
   */
  palenight: {
    accent: '#82aaff',
    border: '#3a3f58',
    danger: '#ff5370',
    focusBorder: '#89ddff',
    gitAdded: '#c3e88d',
    gitDeleted: '#ff5370',
    gitModified: '#ffcb6b',
    info: '#82aaff',
    muted: '#676e95',
    selection: '#3a3f58',
    success: '#c3e88d',
    warning: '#ffcb6b',
  },
  /**
   * GitHub Dark — GitHub
   * @see https://github.com/primer/github-vscode-theme
   */
  'github-dark': {
    accent: '#58a6ff',
    border: '#30363d',
    danger: '#f85149',
    focusBorder: '#58a6ff',
    gitAdded: '#3fb950',
    gitDeleted: '#f85149',
    gitModified: '#d29922',
    info: '#58a6ff',
    muted: '#8b949e',
    selection: '#264f78',
    success: '#3fb950',
    warning: '#d29922',
  },
  /**
   * Horizon — Jonathan Olaleye
   * @see https://github.com/jolaleye/horizon-theme-vscode
   */
  horizon: {
    accent: '#e95678',
    border: '#2e303e',
    danger: '#e95678',
    focusBorder: '#25b0bc',
    gitAdded: '#09f7a0',
    gitDeleted: '#e95678',
    gitModified: '#fab795',
    info: '#25b0bc',
    muted: '#6c6f93',
    selection: '#2e303e',
    success: '#09f7a0',
    warning: '#fab795',
  },
  /**
   * Nightfox — EdenEast
   * @see https://github.com/EdenEast/nightfox.nvim
   */
  nightfox: {
    accent: '#719cd6',
    border: '#2b3b51',
    danger: '#c94f6d',
    focusBorder: '#63cdcf',
    gitAdded: '#81b29a',
    gitDeleted: '#c94f6d',
    gitModified: '#dbc074',
    info: '#719cd6',
    muted: '#738091',
    selection: '#2b3b51',
    success: '#81b29a',
    warning: '#dbc074',
  },
  /**
   * Carbonfox — EdenEast
   * @see https://github.com/EdenEast/nightfox.nvim
   */
  carbonfox: {
    accent: '#78a9ff',
    border: '#353535',
    danger: '#ee5396',
    focusBorder: '#33b1ff',
    gitAdded: '#42be65',
    gitDeleted: '#ee5396',
    gitModified: '#ffe97b',
    info: '#78a9ff',
    muted: '#7b7c7e',
    selection: '#353535',
    success: '#42be65',
    warning: '#ffe97b',
  },
  /**
   * Tokyo Night Storm — Folke Lemaitre
   * @see https://github.com/folke/tokyonight.nvim
   */
  'tokyonight-storm': {
    accent: '#7aa2f7',
    border: '#2f334d',
    danger: '#f7768e',
    focusBorder: '#2ac3de',
    gitAdded: '#9ece6a',
    gitDeleted: '#f7768e',
    gitModified: '#e0af68',
    info: '#2ac3de',
    muted: '#545c7e',
    selection: '#2f334d',
    success: '#9ece6a',
    warning: '#e0af68',
  },
  /**
   * Catppuccin Latte — Catppuccin Org
   * @see https://github.com/catppuccin/catppuccin
   */
  'catppuccin-latte': {
    accent: '#1e66f5',
    border: '#ccd0da',
    danger: '#d20f39',
    focusBorder: '#179299',
    gitAdded: '#40a02b',
    gitDeleted: '#d20f39',
    gitModified: '#df8e1d',
    info: '#1e66f5',
    muted: '#9ca0b0',
    selection: '#ccd0da',
    success: '#40a02b',
    warning: '#df8e1d',
  },
  /**
   * Solarized Light — Ethan Schoonover
   * @see https://github.com/altercation/solarized
   */
  'solarized-light': {
    accent: '#268bd2',
    border: '#eee8d5',
    danger: '#dc322f',
    focusBorder: '#2aa198',
    gitAdded: '#859900',
    gitDeleted: '#dc322f',
    gitModified: '#b58900',
    info: '#268bd2',
    muted: '#93a1a1',
    selection: '#eee8d5',
    success: '#859900',
    warning: '#b58900',
  },
  /**
   * GitHub Light — GitHub
   * @see https://github.com/primer/github-vscode-theme
   */
  'github-light': {
    accent: '#0969da',
    border: '#d0d7de',
    danger: '#cf222e',
    focusBorder: '#0969da',
    gitAdded: '#1a7f37',
    gitDeleted: '#cf222e',
    gitModified: '#9a6700',
    info: '#0969da',
    muted: '#656d76',
    selection: '#ddf4ff',
    success: '#1a7f37',
    warning: '#9a6700',
  },
  /**
   * Iceberg — cocopon
   * @see https://github.com/cocopon/iceberg.vim
   */
  iceberg: {
    accent: '#84a0c6',
    border: '#1e2132',
    danger: '#e27878',
    focusBorder: '#89b8c2',
    gitAdded: '#b4be82',
    gitDeleted: '#e27878',
    gitModified: '#e2a478',
    info: '#84a0c6',
    muted: '#6b7089',
    selection: '#1e2132',
    success: '#b4be82',
    warning: '#e2a478',
  },
  /**
   * Material Ocean — Mattia Astorino
   * @see https://github.com/material-theme/vsc-material-theme
   */
  'material-ocean': {
    accent: '#82aaff',
    border: '#2b2f3a',
    danger: '#f07178',
    focusBorder: '#89ddff',
    gitAdded: '#c3e88d',
    gitDeleted: '#f07178',
    gitModified: '#ffcb6b',
    info: '#82aaff',
    muted: '#464b5d',
    selection: '#2b2f3a',
    success: '#c3e88d',
    warning: '#ffcb6b',
  },
  /**
   * Moonlight — atomiks
   * @see https://github.com/atomiks/moonlight-vscode-theme
   */
  moonlight: {
    accent: '#82aaff',
    border: '#2f334d',
    danger: '#ff757f',
    focusBorder: '#86e1fc',
    gitAdded: '#c3e88d',
    gitDeleted: '#ff757f',
    gitModified: '#ffc777',
    info: '#82aaff',
    muted: '#636da6',
    selection: '#2f334d',
    success: '#c3e88d',
    warning: '#ffc777',
  },
  /**
   * Poimandres — drcmda
   * @see https://github.com/drcmda/poimandres-theme
   */
  poimandres: {
    accent: '#add7ff',
    border: '#1b1e28',
    danger: '#d0679d',
    focusBorder: '#5de4c7',
    gitAdded: '#5de4c7',
    gitDeleted: '#d0679d',
    gitModified: '#fffac2',
    info: '#add7ff',
    muted: '#506477',
    selection: '#1b1e28',
    success: '#5de4c7',
    warning: '#fffac2',
  },
  /**
   * Vitesse Dark — Anthony Fu
   * @see https://github.com/antfu/vscode-theme-vitesse
   */
  'vitesse-dark': {
    accent: '#4d9375',
    border: '#282828',
    danger: '#cb7676',
    focusBorder: '#4d9375',
    gitAdded: '#4d9375',
    gitDeleted: '#cb7676',
    gitModified: '#e6cc77',
    info: '#6394bf',
    muted: '#758575',
    selection: '#282828',
    success: '#4d9375',
    warning: '#e6cc77',
  },
  /**
   * Vesper — Raunó Freiberg
   * @see https://github.com/raunofreiberg/vesper
   */
  vesper: {
    accent: '#ffc799',
    border: '#232323',
    danger: '#f5a191',
    focusBorder: '#99ffe4',
    gitAdded: '#99ffe4',
    gitDeleted: '#f5a191',
    gitModified: '#ffc799',
    info: '#a0c4ff',
    muted: '#575757',
    selection: '#232323',
    success: '#99ffe4',
    warning: '#ffc799',
  },
  /**
   * Flexoki Dark — Steph Ango
   * @see https://github.com/kepano/flexoki
   */
  flexoki: {
    accent: '#205ea6',
    border: '#343331',
    danger: '#af3029',
    focusBorder: '#24837b',
    gitAdded: '#66800b',
    gitDeleted: '#af3029',
    gitModified: '#ad8301',
    info: '#205ea6',
    muted: '#878580',
    selection: '#343331',
    success: '#66800b',
    warning: '#ad8301',
  },
  /**
   * Mellow — mellow-theme
   * @see https://github.com/mellow-theme/mellow.nvim
   */
  mellow: {
    accent: '#7eb8da',
    border: '#2a2a2a',
    danger: '#f5a191',
    focusBorder: '#a3d4a0',
    gitAdded: '#a3d4a0',
    gitDeleted: '#f5a191',
    gitModified: '#f0c674',
    info: '#7eb8da',
    muted: '#6b6b6b',
    selection: '#2a2a2a',
    success: '#a3d4a0',
    warning: '#f0c674',
  },
  /**
   * Night Owl — Sarah Drasner
   * @see https://github.com/sdras/night-owl-vscode-theme
   */
  'night-owl': {
    accent: '#82aaff',
    border: '#1d3b53',
    danger: '#ef5350',
    focusBorder: '#7fdbca',
    gitAdded: '#addb67',
    gitDeleted: '#ef5350',
    gitModified: '#ecc48d',
    info: '#82aaff',
    muted: '#637777',
    selection: '#1d3b53',
    success: '#addb67',
    warning: '#ecc48d',
  },
  /**
   * Cobalt2 — Wes Bos
   * @see https://github.com/wesbos/cobalt2-vscode
   */
  cobalt2: {
    accent: '#ffc600',
    border: '#234e6d',
    danger: '#ff628c',
    focusBorder: '#9effff',
    gitAdded: '#3ad900',
    gitDeleted: '#ff628c',
    gitModified: '#ffc600',
    info: '#9effff',
    muted: '#627e99',
    selection: '#0d3a58',
    success: '#3ad900',
    warning: '#ffc600',
  },
  /**
   * Oceanic Next — mhartington
   * @see https://github.com/mhartington/oceanic-next
   */
  'oceanic-next': {
    accent: '#6699cc',
    border: '#343d46',
    danger: '#ec5f67',
    focusBorder: '#5fb3b3',
    gitAdded: '#99c794',
    gitDeleted: '#ec5f67',
    gitModified: '#fac863',
    info: '#6699cc',
    muted: '#65737e',
    selection: '#4f5b66',
    success: '#99c794',
    warning: '#fac863',
  },
  /**
   * Catppuccin Macchiato — Catppuccin Org
   * @see https://github.com/catppuccin/catppuccin
   */
  'catppuccin-macchiato': {
    accent: '#8aadf4',
    border: '#494d64',
    danger: '#ed8796',
    focusBorder: '#91d7e3',
    gitAdded: '#a6da95',
    gitDeleted: '#ed8796',
    gitModified: '#eed49f',
    info: '#8aadf4',
    muted: '#6e738d',
    selection: '#363a4f',
    success: '#a6da95',
    warning: '#eed49f',
  },
  /**
   * Gruvbox Light — Pavel Pertsev
   * @see https://github.com/morhetz/gruvbox
   */
  'gruvbox-light': {
    accent: '#076678',
    border: '#bdae93',
    danger: '#9d0006',
    focusBorder: '#427b58',
    gitAdded: '#79740e',
    gitDeleted: '#9d0006',
    gitModified: '#b57614',
    info: '#076678',
    muted: '#7c6f64',
    selection: '#ebdbb2',
    success: '#79740e',
    warning: '#b57614',
  },
  /**
   * Tokyo Night Day — Folke Lemaitre
   * @see https://github.com/folke/tokyonight.nvim
   */
  'tokyo-night-day': {
    accent: '#2e7de9',
    border: '#b7c1e3',
    danger: '#f52a65',
    focusBorder: '#007197',
    gitAdded: '#587539',
    gitDeleted: '#f52a65',
    gitModified: '#8c6c3e',
    info: '#2e7de9',
    muted: '#848cb5',
    selection: '#b7c1e3',
    success: '#587539',
    warning: '#8c6c3e',
  },
  /**
   * One Light — Atom team
   * @see https://github.com/atom/atom
   */
  'one-light': {
    accent: '#4078f2',
    border: '#d4d4d4',
    danger: '#e45649',
    focusBorder: '#0184bc',
    gitAdded: '#50a14f',
    gitDeleted: '#e45649',
    gitModified: '#c18401',
    info: '#4078f2',
    muted: '#a0a1a7',
    selection: '#e5e5e6',
    success: '#50a14f',
    warning: '#c18401',
  },
  /**
   * Ayu Light — Ike Ku
   * @see https://github.com/dempfi/ayu
   */
  'ayu-light': {
    accent: '#fa8d3e',
    border: '#e6e6e6',
    danger: '#e65050',
    focusBorder: '#4cbf99',
    gitAdded: '#6cbf43',
    gitDeleted: '#e65050',
    gitModified: '#f2ae49',
    info: '#399ee6',
    muted: '#abb0b6',
    selection: '#d1e4f4',
    success: '#6cbf43',
    warning: '#f2ae49',
  },
  /**
   * Rosé Pine Dawn — Rosé Pine team
   * @see https://github.com/rose-pine/rose-pine-theme
   */
  'rose-pine-dawn': {
    accent: '#907aa9',
    border: '#dfdad9',
    danger: '#b4637a',
    focusBorder: '#56949f',
    gitAdded: '#286983',
    gitDeleted: '#b4637a',
    gitModified: '#ea9d34',
    info: '#56949f',
    muted: '#9893a5',
    selection: '#dfdad9',
    success: '#286983',
    warning: '#ea9d34',
  },
  /**
   * Everforest Light — sainnhe
   * @see https://github.com/sainnhe/everforest
   */
  'everforest-light': {
    accent: '#8da101',
    border: '#ddd8be',
    danger: '#f85552',
    focusBorder: '#35a77c',
    gitAdded: '#8da101',
    gitDeleted: '#f85552',
    gitModified: '#dfa000',
    info: '#3a94c5',
    muted: '#939f91',
    selection: '#edeada',
    success: '#8da101',
    warning: '#dfa000',
  },
  /**
   * Vitesse Light — Anthony Fu
   * @see https://github.com/antfu/vscode-theme-vitesse
   */
  'vitesse-light': {
    accent: '#1e754f',
    border: '#e0e0e0',
    danger: '#ab5959',
    focusBorder: '#2993a3',
    gitAdded: '#1e754f',
    gitDeleted: '#ab5959',
    gitModified: '#b07d48',
    info: '#296aa3',
    muted: '#999fa6',
    selection: '#eaeaeb',
    success: '#1e754f',
    warning: '#b07d48',
  },
  /**
   * Dayfox — EdenEast
   * @see https://github.com/EdenEast/nightfox.nvim
   */
  dayfox: {
    accent: '#2848a9',
    border: '#e4dcd4',
    danger: '#a5222f',
    focusBorder: '#287980',
    gitAdded: '#396847',
    gitDeleted: '#a5222f',
    gitModified: '#ac5402',
    info: '#2848a9',
    muted: '#908479',
    selection: '#e7d2be',
    success: '#396847',
    warning: '#ac5402',
  },
  /**
   * Night Owl Light — Sarah Drasner
   * @see https://github.com/sdras/night-owl-vscode-theme
   */
  'night-owl-light': {
    accent: '#288ed7',
    border: '#d9d9d9',
    danger: '#d3423e',
    focusBorder: '#2aa298',
    gitAdded: '#08916a',
    gitDeleted: '#d3423e',
    gitModified: '#daaa01',
    info: '#288ed7',
    muted: '#989fb1',
    selection: '#e4e8f0',
    success: '#08916a',
    warning: '#daaa01',
  },
  /**
   * Flexoki Light — Steph Ango
   * @see https://github.com/kepano/flexoki
   */
  'flexoki-light': {
    accent: '#205ea6',
    border: '#cecdc3',
    danger: '#af3029',
    focusBorder: '#24837b',
    gitAdded: '#66800b',
    gitDeleted: '#af3029',
    gitModified: '#ad8301',
    info: '#205ea6',
    muted: '#6f6e69',
    selection: '#e6e4d9',
    success: '#66800b',
    warning: '#ad8301',
  },
  /**
   * Material Lighter — Mattia Astorino
   * @see https://github.com/material-theme/vsc-material-theme
   */
  'material-lighter': {
    accent: '#39adb5',
    border: '#e7eaec',
    danger: '#e53935',
    focusBorder: '#39adb5',
    gitAdded: '#91b859',
    gitDeleted: '#e53935',
    gitModified: '#f6a434',
    info: '#6182b8',
    muted: '#90a4ae',
    selection: '#d3e1e8',
    success: '#91b859',
    warning: '#f6a434',
  },
  /**
   * PaperColor Light — nlknguyen
   * @see https://github.com/nlknguyen/papercolor-theme
   */
  'papercolor-light': {
    accent: '#0087af',
    border: '#d7d7d7',
    danger: '#af0000',
    focusBorder: '#005f87',
    gitAdded: '#008700',
    gitDeleted: '#af0000',
    gitModified: '#d75f00',
    info: '#0087af',
    muted: '#878787',
    selection: '#d0d0d0',
    success: '#008700',
    warning: '#d75f00',
  },
  /**
   * Modus Operandi — Protesilaos Stavrou
   * @see https://github.com/protesilaos/modus-themes
   */
  'modus-operandi': {
    accent: '#0031a9',
    border: '#d7d7d7',
    danger: '#a60000',
    focusBorder: '#005e8b',
    gitAdded: '#006800',
    gitDeleted: '#a60000',
    gitModified: '#6f5500',
    info: '#0031a9',
    muted: '#595959',
    selection: '#c0deff',
    success: '#006800',
    warning: '#6f5500',
  },
  /**
   * Quiet Light — Microsoft
   * @see https://github.com/microsoft/vscode
   */
  'quiet-light': {
    accent: '#4b83cd',
    border: '#e0e0e0',
    danger: '#aa3731',
    focusBorder: '#4b83cd',
    gitAdded: '#448c27',
    gitDeleted: '#aa3731',
    gitModified: '#a67d00',
    info: '#4b83cd',
    muted: '#a3a6ad',
    selection: '#c9d0d9',
    success: '#448c27',
    warning: '#a67d00',
  },
  /**
   * Catppuccin Frappé — Catppuccin Org
   * @see https://github.com/catppuccin/catppuccin
   */
  'catppuccin-frappe': {
    accent: '#8caaee',
    border: '#51576d',
    danger: '#e78284',
    focusBorder: '#81c8be',
    gitAdded: '#a6d189',
    gitDeleted: '#e78284',
    gitModified: '#e5c890',
    info: '#8caaee',
    muted: '#737994',
    selection: '#414559',
    success: '#a6d189',
    warning: '#e5c890',
  },
  /**
   * Rosé Pine Moon — Rosé Pine team
   * @see https://github.com/rose-pine/rose-pine-theme
   */
  'rose-pine-moon': {
    accent: '#c4a7e7',
    border: '#393552',
    danger: '#eb6f92',
    focusBorder: '#9ccfd8',
    gitAdded: '#3e8fb0',
    gitDeleted: '#eb6f92',
    gitModified: '#f6c177',
    info: '#9ccfd8',
    muted: '#6e6a86',
    selection: '#44415a',
    success: '#3e8fb0',
    warning: '#f6c177',
  },
  /**
   * Kanagawa Dragon — rebelot
   * @see https://github.com/rebelot/kanagawa.nvim
   */
  'kanagawa-dragon': {
    accent: '#8ba4b0',
    border: '#282727',
    danger: '#c4746e',
    focusBorder: '#8ea4a2',
    gitAdded: '#87a987',
    gitDeleted: '#c4746e',
    gitModified: '#c4b28a',
    info: '#8ba4b0',
    muted: '#737c73',
    selection: '#2d4f67',
    success: '#87a987',
    warning: '#c4b28a',
  },
  /**
   * Kanagawa Lotus — rebelot
   * @see https://github.com/rebelot/kanagawa.nvim
   */
  'kanagawa-lotus': {
    accent: '#4d699b',
    border: '#e5ddb0',
    danger: '#c84053',
    focusBorder: '#597b75',
    gitAdded: '#6f894e',
    gitDeleted: '#c84053',
    gitModified: '#77713f',
    info: '#4d699b',
    muted: '#8a8980',
    selection: '#dcd5ac',
    success: '#6f894e',
    warning: '#77713f',
  },
  /**
   * Nordfox — EdenEast
   * @see https://github.com/EdenEast/nightfox.nvim
   */
  nordfox: {
    accent: '#81a1c1',
    border: '#39404f',
    danger: '#bf616a',
    focusBorder: '#88c0d0',
    gitAdded: '#a3be8c',
    gitDeleted: '#bf616a',
    gitModified: '#ebcb8b',
    info: '#81a1c1',
    muted: '#60728a',
    selection: '#3e4a5b',
    success: '#a3be8c',
    warning: '#ebcb8b',
  },
  /**
   * Duskfox — EdenEast
   * @see https://github.com/EdenEast/nightfox.nvim
   */
  duskfox: {
    accent: '#569fba',
    border: '#2d2a45',
    danger: '#eb6f92',
    focusBorder: '#9ccfd8',
    gitAdded: '#a3be8c',
    gitDeleted: '#eb6f92',
    gitModified: '#f6c177',
    info: '#569fba',
    muted: '#817c9c',
    selection: '#433c59',
    success: '#a3be8c',
    warning: '#f6c177',
  },
  /**
   * Terafox — EdenEast
   * @see https://github.com/EdenEast/nightfox.nvim
   */
  terafox: {
    accent: '#5a93aa',
    border: '#1d3337',
    danger: '#e85c51',
    focusBorder: '#a1cdd8',
    gitAdded: '#7aa4a1',
    gitDeleted: '#e85c51',
    gitModified: '#fda47f',
    info: '#5a93aa',
    muted: '#6d7f8b',
    selection: '#293e40',
    success: '#7aa4a1',
    warning: '#fda47f',
  },
  /**
   * Dawnfox — EdenEast
   * @see https://github.com/EdenEast/nightfox.nvim
   */
  dawnfox: {
    accent: '#286983',
    border: '#ebe0df',
    danger: '#b4637a',
    focusBorder: '#56949f',
    gitAdded: '#618774',
    gitDeleted: '#b4637a',
    gitModified: '#ea9d34',
    info: '#286983',
    muted: '#9893a5',
    selection: '#eadcd8',
    success: '#618774',
    warning: '#ea9d34',
  },
  /**
   * Ayu Mirage — Ike Ku
   * @see https://github.com/dempfi/ayu
   */
  'ayu-mirage': {
    accent: '#ffcc66',
    border: '#323843',
    danger: '#f28779',
    focusBorder: '#95e6cb',
    gitAdded: '#d5ff80',
    gitDeleted: '#f28779',
    gitModified: '#ffd173',
    info: '#73d0ff',
    muted: '#5c6773',
    selection: '#33415e',
    success: '#d5ff80',
    warning: '#ffd173',
  },
  /**
   * Material Darker — Mattia Astorino
   * @see https://github.com/material-theme/vsc-material-theme
   */
  'material-darker': {
    accent: '#82aaff',
    border: '#343434',
    danger: '#f07178',
    focusBorder: '#89ddff',
    gitAdded: '#c3e88d',
    gitDeleted: '#f07178',
    gitModified: '#ffcb6b',
    info: '#82aaff',
    muted: '#545454',
    selection: '#404040',
    success: '#c3e88d',
    warning: '#ffcb6b',
  },
  /**
   * Tokyo Night Moon — atomiks
   * @see https://github.com/atomiks/moonlight-vscode-theme
   */
  'tokyo-night-moon': {
    accent: '#82aaff',
    border: '#2f334d',
    danger: '#ff757f',
    focusBorder: '#86e1fc',
    gitAdded: '#c3e88d',
    gitDeleted: '#ff757f',
    gitModified: '#ffc777',
    info: '#82aaff',
    muted: '#636da6',
    selection: '#2d3f76',
    success: '#c3e88d',
    warning: '#ffc777',
  },
  /**
   * Gruvbox Material — sainnhe
   * @see https://github.com/sainnhe/gruvbox-material
   */
  'gruvbox-material': {
    accent: '#7daea3',
    border: '#504945',
    danger: '#ea6962',
    focusBorder: '#89b482',
    gitAdded: '#a9b665',
    gitDeleted: '#ea6962',
    gitModified: '#d8a657',
    info: '#7daea3',
    muted: '#928374',
    selection: '#3c3836',
    success: '#a9b665',
    warning: '#d8a657',
  },
  /**
   * Gruvbox Material Light — sainnhe
   * @see https://github.com/sainnhe/gruvbox-material
   */
  'gruvbox-material-light': {
    accent: '#45707a',
    border: '#ddccab',
    danger: '#c14a4a',
    focusBorder: '#4c7a5d',
    gitAdded: '#6c782e',
    gitDeleted: '#c14a4a',
    gitModified: '#b47109',
    info: '#45707a',
    muted: '#928374',
    selection: '#eee0b7',
    success: '#6c782e',
    warning: '#b47109',
  },
  /**
   * Modus Vivendi — Protesilaos Stavrou
   * @see https://github.com/protesilaos/modus-themes
   */
  'modus-vivendi': {
    accent: '#2fafff',
    border: '#646464',
    danger: '#ff5f59',
    focusBorder: '#00d3d0',
    gitAdded: '#44bc44',
    gitDeleted: '#ff5f59',
    gitModified: '#d0bc00',
    info: '#2fafff',
    muted: '#989898',
    selection: '#5a5a5a',
    success: '#44bc44',
    warning: '#d0bc00',
  },
  /**
   * Zenburn — Jani Nurminen
   * @see https://github.com/jnurmine/Zenburn
   */
  zenburn: {
    accent: '#8cd0d3',
    border: '#4f4f4f',
    danger: '#cc9393',
    focusBorder: '#93e0e3',
    gitAdded: '#7f9f7f',
    gitDeleted: '#cc9393',
    gitModified: '#f0dfaf',
    info: '#8cd0d3',
    muted: '#9f9f8f',
    selection: '#5f5f5f',
    success: '#7f9f7f',
    warning: '#f0dfaf',
  },
  /**
   * Oxocarbon — nyoom-engineering
   * @see https://github.com/nyoom-engineering/oxocarbon.nvim
   */
  oxocarbon: {
    accent: '#33b1ff',
    border: '#525252',
    danger: '#ee5396',
    focusBorder: '#3ddbd9',
    gitAdded: '#42be65',
    gitDeleted: '#ee5396',
    gitModified: '#ab8e34',
    info: '#33b1ff',
    muted: '#6f6f6f',
    selection: '#2a2a2a',
    success: '#42be65',
    warning: '#ab8e34',
  },
  /**
   * Tomorrow Night — Chris Kempson
   * @see https://github.com/chriskempson/tomorrow-theme
   */
  'tomorrow-night': {
    accent: '#81a2be',
    border: '#373b41',
    danger: '#cc6666',
    focusBorder: '#8abeb7',
    gitAdded: '#b5bd68',
    gitDeleted: '#cc6666',
    gitModified: '#f0c674',
    info: '#81a2be',
    muted: '#969896',
    selection: '#373b41',
    success: '#b5bd68',
    warning: '#f0c674',
  },
  /**
   * Monokai Pro — Wimer Hazenberg
   * @see https://monokai.pro
   */
  'monokai-pro': {
    accent: '#78dce8',
    border: '#403e41',
    danger: '#ff6188',
    focusBorder: '#a9dc76',
    gitAdded: '#a9dc76',
    gitDeleted: '#ff6188',
    gitModified: '#ffd866',
    info: '#78dce8',
    muted: '#727072',
    selection: '#5b595c',
    success: '#a9dc76',
    warning: '#ffd866',
  },
  /**
   * Sonokai — sainnhe
   * @see https://github.com/sainnhe/sonokai
   */
  sonokai: {
    accent: '#76cce0',
    border: '#33353f',
    danger: '#fc5d7c',
    focusBorder: '#9ed072',
    gitAdded: '#9ed072',
    gitDeleted: '#fc5d7c',
    gitModified: '#e7c664',
    info: '#76cce0',
    muted: '#7f8490',
    selection: '#414550',
    success: '#9ed072',
    warning: '#e7c664',
  },
  /**
   * Doom One — Henrik Lissner
   * @see https://github.com/hlissner/emacs-doom-themes
   */
  'doom-one': {
    accent: '#51afef',
    border: '#3f444a',
    danger: '#ff6c6b',
    focusBorder: '#46d9ff',
    gitAdded: '#98be65',
    gitDeleted: '#ff6c6b',
    gitModified: '#ecbe7b',
    info: '#51afef',
    muted: '#5b6268',
    selection: '#42444a',
    success: '#98be65',
    warning: '#ecbe7b',
  },
  /**
   * Andromeda — EliverLara
   * @see https://github.com/EliverLara/Andromeda
   */
  andromeda: {
    accent: '#00e8c6',
    border: '#2b2e36',
    danger: '#ee5d43',
    focusBorder: '#00e8c6',
    gitAdded: '#96e072',
    gitDeleted: '#ee5d43',
    gitModified: '#ffe66d',
    info: '#7cb7ff',
    muted: '#a0a1a7',
    selection: '#3d4352',
    success: '#96e072',
    warning: '#ffe66d',
  },
  /**
   * Aura — Dalton Menezes
   * @see https://github.com/daltonmenezes/aura-theme
   */
  aura: {
    accent: '#a277ff',
    border: '#363c49',
    danger: '#ff6767',
    focusBorder: '#61ffca',
    gitAdded: '#61ffca',
    gitDeleted: '#ff6767',
    gitModified: '#ffca85',
    info: '#82e2ff',
    muted: '#6d6d6d',
    selection: '#3d375e',
    success: '#61ffca',
    warning: '#ffca85',
  },
  /**
   * Cyberdream — Scott McKendry
   * @see https://github.com/scottmckendry/cyberdream.nvim
   */
  cyberdream: {
    accent: '#5ea1ff',
    border: '#1e2124',
    danger: '#ff6e5e',
    focusBorder: '#5ef1ff',
    gitAdded: '#5eff6c',
    gitDeleted: '#ff6e5e',
    gitModified: '#f1ff5e',
    info: '#5ea1ff',
    muted: '#7b8496',
    selection: '#3c4048',
    success: '#5eff6c',
    warning: '#f1ff5e',
  },
  /**
   * Nightfly — bluz71
   * @see https://github.com/bluz71/vim-nightfly-colors
   */
  nightfly: {
    accent: '#82aaff',
    border: '#1d3b53',
    danger: '#fc514e',
    focusBorder: '#7fdbca',
    gitAdded: '#a1cd5e',
    gitDeleted: '#fc514e',
    gitModified: '#e3d18a',
    info: '#82aaff',
    muted: '#7c8f8f',
    selection: '#1d3b53',
    success: '#a1cd5e',
    warning: '#e3d18a',
  },
  /**
   * Panda Syntax — Tommaso Negri
   * @see https://github.com/tinkertrain/panda-syntax
   */
  panda: {
    accent: '#ff75b5',
    border: '#404954',
    danger: '#ff4b82',
    focusBorder: '#19f9d8',
    gitAdded: '#19f9d8',
    gitDeleted: '#ff4b82',
    gitModified: '#ffb86c',
    info: '#45a9f9',
    muted: '#676b79',
    selection: '#373841',
    success: '#19f9d8',
    warning: '#ffb86c',
  },
  /**
   * Hyper Snazzy — Sindre Sorhus
   * @see https://github.com/sindresorhus/hyper-snazzy
   */
  'hyper-snazzy': {
    accent: '#57c7ff',
    border: '#43454f',
    danger: '#ff5c57',
    focusBorder: '#9aedfe',
    gitAdded: '#5af78e',
    gitDeleted: '#ff5c57',
    gitModified: '#f3f99d',
    info: '#57c7ff',
    muted: '#686868',
    selection: '#3a3d4d',
    success: '#5af78e',
    warning: '#f3f99d',
  },
  /**
   * Apprentice — romainl
   * @see https://github.com/romainl/Apprentice
   */
  apprentice: {
    accent: '#5f87af',
    border: '#444444',
    danger: '#af5f5f',
    focusBorder: '#5f8787',
    gitAdded: '#5f875f',
    gitDeleted: '#af5f5f',
    gitModified: '#ffffaf',
    info: '#5f87af',
    muted: '#6c6c6c',
    selection: '#444444',
    success: '#5f875f',
    warning: '#ffffaf',
  },
  /**
   * Melange — savq
   * @see https://github.com/savq/melange-nvim
   */
  melange: {
    accent: '#a3a9ce',
    border: '#34302c',
    danger: '#d47766',
    focusBorder: '#89b3b6',
    gitAdded: '#85b695',
    gitDeleted: '#d47766',
    gitModified: '#ebc06d',
    info: '#a3a9ce',
    muted: '#867462',
    selection: '#403a36',
    success: '#85b695',
    warning: '#ebc06d',
  },
  /**
   * Melange Light — savq
   * @see https://github.com/savq/melange-nvim
   */
  'melange-light': {
    accent: '#465aa4',
    border: '#e9e1db',
    danger: '#bf0021',
    focusBorder: '#3d6568',
    gitAdded: '#3a684a',
    gitDeleted: '#bf0021',
    gitModified: '#a06d00',
    info: '#465aa4',
    muted: '#7d6658',
    selection: '#d9d3ce',
    success: '#3a684a',
    warning: '#a06d00',
  },
  /**
   * Spaceduck — pineapplegiant
   * @see https://github.com/pineapplegiant/spaceduck
   */
  spaceduck: {
    accent: '#00a3cc',
    border: '#30365f',
    danger: '#e33400',
    focusBorder: '#ce6f8f',
    gitAdded: '#5ccc96',
    gitDeleted: '#e33400',
    gitModified: '#f2ce00',
    info: '#7a5ccc',
    muted: '#686f9a',
    selection: '#30365f',
    success: '#5ccc96',
    warning: '#f2ce00',
  },
  /**
   * Embark — Embark Studios
   * @see https://github.com/embark-theme/vim
   */
  embark: {
    accent: '#d4bfff',
    border: '#585273',
    danger: '#f48fb1',
    focusBorder: '#abf8f7',
    gitAdded: '#a1efd3',
    gitDeleted: '#f48fb1',
    gitModified: '#ffe6b3',
    info: '#91ddff',
    muted: '#8a889d',
    selection: '#3e3859',
    success: '#a1efd3',
    warning: '#ffe6b3',
  },
  /**
   * Bluloco Dark — uloco
   * @see https://github.com/uloco/theme-bluloco-dark
   */
  'bluloco-dark': {
    accent: '#3691ff',
    border: '#3d434f',
    danger: '#ff2e3f',
    focusBorder: '#4483aa',
    gitAdded: '#3fc56b',
    gitDeleted: '#ff2e3f',
    gitModified: '#f9c859',
    info: '#3691ff',
    muted: '#636d83',
    selection: '#2f343e',
    success: '#3fc56b',
    warning: '#f9c859',
  },
  /**
   * Bluloco Light — uloco
   * @see https://github.com/uloco/theme-bluloco-light
   */
  'bluloco-light': {
    accent: '#275fe4',
    border: '#d5d7d8',
    danger: '#d52753',
    focusBorder: '#40b8c5',
    gitAdded: '#23974a',
    gitDeleted: '#d52753',
    gitModified: '#c5a332',
    info: '#275fe4',
    muted: '#a0a1a7',
    selection: '#d2ecff',
    success: '#23974a',
    warning: '#c5a332',
  },
  /**
   * PaperColor Dark — nlknguyen
   * @see https://github.com/nlknguyen/papercolor-theme
   */
  'papercolor-dark': {
    accent: '#5fafd7',
    border: '#444444',
    danger: '#af005f',
    focusBorder: '#00afaf',
    gitAdded: '#5faf00',
    gitDeleted: '#af005f',
    gitModified: '#d7af5f',
    info: '#5fafd7',
    muted: '#808080',
    selection: '#303030',
    success: '#5faf00',
    warning: '#d7af5f',
  },
  /**
   * Base16 Ocean — Chris Kempson
   * @see https://github.com/chriskempson/base16
   */
  'base16-ocean': {
    accent: '#8fa1b3',
    border: '#343d46',
    danger: '#bf616a',
    focusBorder: '#96b5b4',
    gitAdded: '#a3be8c',
    gitDeleted: '#bf616a',
    gitModified: '#ebcb8b',
    info: '#8fa1b3',
    muted: '#65737e',
    selection: '#4f5b66',
    success: '#a3be8c',
    warning: '#ebcb8b',
  },
  /**
   * Base16 Eighties — Chris Kempson
   * @see https://github.com/chriskempson/base16
   */
  'base16-eighties': {
    accent: '#6699cc',
    border: '#393939',
    danger: '#f2777a',
    focusBorder: '#66cccc',
    gitAdded: '#99cc99',
    gitDeleted: '#f2777a',
    gitModified: '#ffcc66',
    info: '#6699cc',
    muted: '#747369',
    selection: '#515151',
    success: '#99cc99',
    warning: '#ffcc66',
  },
  /**
   * Everblush — Everblush team
   * @see https://github.com/Everblush/everblush.nvim
   */
  everblush: {
    accent: '#67b0e8',
    border: '#232a2d',
    danger: '#e57474',
    focusBorder: '#6cbfbf',
    gitAdded: '#8ccf7e',
    gitDeleted: '#e57474',
    gitModified: '#e5c76b',
    info: '#67b0e8',
    muted: '#5e6164',
    selection: '#2d3437',
    success: '#8ccf7e',
    warning: '#e5c76b',
  },
  /**
   * Darcula — JetBrains
   * @see https://www.jetbrains.com
   */
  darcula: {
    accent: '#cc7832',
    border: '#3c3f41',
    danger: '#ff6b68',
    focusBorder: '#629755',
    gitAdded: '#6a8759',
    gitDeleted: '#ff6b68',
    gitModified: '#ffc66d',
    info: '#6897bb',
    muted: '#808080',
    selection: '#214283',
    success: '#6a8759',
    warning: '#ffc66d',
  },
  /**
   * Eldritch — eldritch-theme
   * @see https://github.com/eldritch-theme/eldritch.nvim
   */
  eldritch: {
    accent: '#a48cf2',
    border: '#292e42',
    danger: '#f16c75',
    focusBorder: '#04d1f9',
    gitAdded: '#37f499',
    gitDeleted: '#f16c75',
    gitModified: '#f1fc79',
    info: '#04d1f9',
    muted: '#7081d0',
    selection: '#2d3052',
    success: '#37f499',
    warning: '#f1fc79',
  },
  /**
   * Edge Light — sainnhe
   * @see https://github.com/sainnhe/edge
   */
  'edge-light': {
    accent: '#5079be',
    border: '#dde2e7',
    danger: '#d05858',
    focusBorder: '#3a8b84',
    gitAdded: '#608e32',
    gitDeleted: '#d05858',
    gitModified: '#be7e05',
    info: '#5079be',
    muted: '#a0a1a7',
    selection: '#e3e6eb',
    success: '#608e32',
    warning: '#be7e05',
  },
  /**
   * Zenbones — zenbones-theme
   * @see https://github.com/zenbones-theme/zenbones.nvim
   */
  zenbones: {
    accent: '#286486',
    border: '#cfd1d0',
    danger: '#a8334c',
    focusBorder: '#3b8992',
    gitAdded: '#4f6c31',
    gitDeleted: '#a8334c',
    gitModified: '#944927',
    info: '#286486',
    muted: '#a8a29e',
    selection: '#cbd9e3',
    success: '#4f6c31',
    warning: '#944927',
  },
  /**
   * Iceberg Light — cocopon
   * @see https://github.com/cocopon/iceberg.vim
   */
  'iceberg-light': {
    accent: '#2d539e',
    border: '#cad0de',
    danger: '#cc517a',
    focusBorder: '#3f83a6',
    gitAdded: '#668e3d',
    gitDeleted: '#cc517a',
    gitModified: '#c57339',
    info: '#2d539e',
    muted: '#8389a3',
    selection: '#c9cdd7',
    success: '#668e3d',
    warning: '#c57339',
  },
  /**
   * GitHub Dark Dimmed — GitHub
   * @see https://github.com/primer/github-vscode-theme
   */
  'github-dark-dimmed': {
    accent: '#539bf5',
    border: '#444c56',
    danger: '#f47067',
    focusBorder: '#39c5cf',
    gitAdded: '#57ab5a',
    gitDeleted: '#f47067',
    gitModified: '#c69026',
    info: '#539bf5',
    muted: '#636e7b',
    selection: '#2d333b',
    success: '#57ab5a',
    warning: '#c69026',
  },
  /**
   * Edge Dark — sainnhe
   * @see https://github.com/sainnhe/edge
   */
  'edge-dark': {
    accent: '#6cb6eb',
    border: '#414550',
    danger: '#ec7279',
    focusBorder: '#5dbbc1',
    gitAdded: '#a0c980',
    gitDeleted: '#ec7279',
    gitModified: '#deb974',
    info: '#6cb6eb',
    muted: '#758094',
    selection: '#3b3e48',
    success: '#a0c980',
    warning: '#deb974',
  },
  /**
   * Selenized Dark — Jan Warchoł
   * @see https://github.com/jan-warchol/selenized
   */
  'selenized-dark': {
    accent: '#4695f7',
    border: '#2d5b69',
    danger: '#fa5750',
    focusBorder: '#41c7b9',
    gitAdded: '#75b938',
    gitDeleted: '#fa5750',
    gitModified: '#dbb32d',
    info: '#4695f7',
    muted: '#72898f',
    selection: '#184956',
    success: '#75b938',
    warning: '#dbb32d',
  },
  /**
   * Selenized Black — Jan Warchoł
   * @see https://github.com/jan-warchol/selenized
   */
  'selenized-black': {
    accent: '#368aeb',
    border: '#3b3b3b',
    danger: '#ed4a46',
    focusBorder: '#3fc5b7',
    gitAdded: '#70b433',
    gitDeleted: '#ed4a46',
    gitModified: '#dbb32d',
    info: '#368aeb',
    muted: '#777777',
    selection: '#252525',
    success: '#70b433',
    warning: '#dbb32d',
  },
  /**
   * Selenized Light — Jan Warchoł
   * @see https://github.com/jan-warchol/selenized
   */
  'selenized-light': {
    accent: '#0072d4',
    border: '#d5cdb6',
    danger: '#d2212d',
    focusBorder: '#009c8f',
    gitAdded: '#489100',
    gitDeleted: '#d2212d',
    gitModified: '#ad8900',
    info: '#0072d4',
    muted: '#909995',
    selection: '#ece3cc',
    success: '#489100',
    warning: '#ad8900',
  },
  /**
   * Monokai Pro Machine — Wimer Hazenberg
   * @see https://monokai.pro
   */
  'monokai-pro-machine': {
    accent: '#7cd5f1',
    border: '#1d2528',
    danger: '#ff6d7e',
    focusBorder: '#a2e57b',
    gitAdded: '#a2e57b',
    gitDeleted: '#ff6d7e',
    gitModified: '#ffed72',
    info: '#7cd5f1',
    muted: '#6b7678',
    selection: '#3a4449',
    success: '#a2e57b',
    warning: '#ffed72',
  },
  /**
   * Monokai Pro Octagon — Wimer Hazenberg
   * @see https://monokai.pro
   */
  'monokai-pro-octagon': {
    accent: '#9cd1bb',
    border: '#1e1f2b',
    danger: '#ff657a',
    focusBorder: '#bad761',
    gitAdded: '#bad761',
    gitDeleted: '#ff657a',
    gitModified: '#ffd76d',
    info: '#9cd1bb',
    muted: '#696d77',
    selection: '#3a3d4b',
    success: '#bad761',
    warning: '#ffd76d',
  },
  /**
   * Monokai Pro Ristretto — Wimer Hazenberg
   * @see https://monokai.pro
   */
  'monokai-pro-ristretto': {
    accent: '#85dacc',
    border: '#211c1c',
    danger: '#fd6883',
    focusBorder: '#adda78',
    gitAdded: '#adda78',
    gitDeleted: '#fd6883',
    gitModified: '#f9cc6c',
    info: '#85dacc',
    muted: '#72696a',
    selection: '#403838',
    success: '#adda78',
    warning: '#f9cc6c',
  },
  /**
   * Monokai Pro Spectrum — Wimer Hazenberg
   * @see https://monokai.pro
   */
  'monokai-pro-spectrum': {
    accent: '#5ad4e6',
    border: '#191919',
    danger: '#fc618d',
    focusBorder: '#7bd88f',
    gitAdded: '#7bd88f',
    gitDeleted: '#fc618d',
    gitModified: '#fce566',
    info: '#5ad4e6',
    muted: '#69676c',
    selection: '#363537',
    success: '#7bd88f',
    warning: '#fce566',
  },
  /**
   * Base16 Default Dark — Chris Kempson
   * @see https://github.com/chriskempson/base16
   */
  'base16-default-dark': {
    accent: '#7cafc2',
    border: '#282828',
    danger: '#ab4642',
    focusBorder: '#86c1b9',
    gitAdded: '#a1b56c',
    gitDeleted: '#ab4642',
    gitModified: '#f7ca88',
    info: '#7cafc2',
    muted: '#585858',
    selection: '#383838',
    success: '#a1b56c',
    warning: '#f7ca88',
  },
  /**
   * Base16 Default Light — Chris Kempson
   * @see https://github.com/chriskempson/base16
   */
  'base16-default-light': {
    accent: '#7cafc2',
    border: '#e8e8e8',
    danger: '#ab4642',
    focusBorder: '#86c1b9',
    gitAdded: '#a1b56c',
    gitDeleted: '#ab4642',
    gitModified: '#dc9656',
    info: '#7cafc2',
    muted: '#b8b8b8',
    selection: '#d8d8d8',
    success: '#a1b56c',
    warning: '#dc9656',
  },
  /**
   * Tomorrow — Chris Kempson
   * @see https://github.com/chriskempson/tomorrow-theme
   */
  tomorrow: {
    accent: '#4271ae',
    border: '#efefef',
    danger: '#c82829',
    focusBorder: '#3e999f',
    gitAdded: '#718c00',
    gitDeleted: '#c82829',
    gitModified: '#eab700',
    info: '#4271ae',
    muted: '#8e908c',
    selection: '#d6d6d6',
    success: '#718c00',
    warning: '#eab700',
  },
  /**
   * Tokyo Dark — Tiagovla
   * @see https://github.com/tiagovla/tokyodark.nvim
   */
  tokyodark: {
    accent: '#a485dd',
    border: '#2a2c41',
    danger: '#ee6d85',
    focusBorder: '#38a89d',
    gitAdded: '#95c561',
    gitDeleted: '#ee6d85',
    gitModified: '#d7a65f',
    info: '#7199ee',
    muted: '#4a5057',
    selection: '#212234',
    success: '#95c561',
    warning: '#d7a65f',
  },
  /**
   * Spacemacs Dark — syl20bnr
   * @see https://github.com/syl20bnr/spacemacs
   */
  'spacemacs-dark': {
    accent: '#bc6ec5',
    border: '#5d4d7a',
    danger: '#f2241f',
    focusBorder: '#2d9574',
    gitAdded: '#67b11d',
    gitDeleted: '#f2241f',
    gitModified: '#b1951d',
    info: '#4f97d7',
    muted: '#6c6783',
    selection: '#444155',
    success: '#67b11d',
    warning: '#b1951d',
  },
  /**
   * Bamboo — ribru17
   * @see https://github.com/ribru17/bamboo.nvim
   */
  bamboo: {
    accent: '#8fb573',
    border: '#3a3d37',
    danger: '#e75a7c',
    focusBorder: '#70c2be',
    gitAdded: '#8fb573',
    gitDeleted: '#e75a7c',
    gitModified: '#dbb651',
    info: '#57a5e5',
    muted: '#838781',
    selection: '#383b35',
    success: '#8fb573',
    warning: '#dbb651',
  },
  /**
   * City Lights — Yummygum
   * @see https://citylights.xyz
   */
  citylights: {
    accent: '#5ec4ff',
    border: '#2f3a42',
    danger: '#e27e8d',
    focusBorder: '#70e1e8',
    gitAdded: '#54af83',
    gitDeleted: '#e27e8d',
    gitModified: '#ebda65',
    info: '#68a1f0',
    muted: '#41505e',
    selection: '#363c43',
    success: '#54af83',
    warning: '#ebda65',
  },
  /**
   * Oxocarbon Light — nyoom-engineering
   * @see https://github.com/nyoom-engineering/oxocarbon.nvim
   */
  'oxocarbon-light': {
    accent: '#0f62fe',
    border: '#e0e0e0',
    danger: '#ee5396',
    focusBorder: '#08bdba',
    gitAdded: '#42be65',
    gitDeleted: '#ee5396',
    gitModified: '#ff6f00',
    info: '#0f62fe',
    muted: '#525252',
    selection: '#dde1e6',
    success: '#42be65',
    warning: '#ff6f00',
  },
  /**
   * VS Code Dark+ — Microsoft
   * @see https://github.com/microsoft/vscode
   */
  'vscode-dark': {
    accent: '#007acc',
    border: '#3c3c3c',
    danger: '#f14c4c',
    focusBorder: '#007acc',
    gitAdded: '#73c991',
    gitDeleted: '#f14c4c',
    gitModified: '#e2c08d',
    info: '#75beff',
    muted: '#6c6c6c',
    selection: '#264f78',
    success: '#4ec9b0',
    warning: '#cca700',
    syntaxKeyword: '#569cd6',
    syntaxString: '#ce9178',
    syntaxComment: '#6a9955',
    syntaxNumber: '#b5cea8',
    syntaxType: '#4ec9b0',
    syntaxFunction: '#dcdcaa',
    syntaxConstant: '#9cdcfe',
    syntaxProperty: '#9cdcfe',
  },
  /**
   * VS Code Light+ — Microsoft
   * @see https://github.com/microsoft/vscode
   */
  'vscode-light': {
    accent: '#0078d7',
    border: '#d4d4d4',
    danger: '#cd3131',
    focusBorder: '#0090f1',
    gitAdded: '#587c0c',
    gitDeleted: '#ad0707',
    gitModified: '#895503',
    info: '#1a85ff',
    muted: '#8c8c8c',
    selection: '#add6ff',
    success: '#587c0c',
    warning: '#895503',
    syntaxKeyword: '#0000ff',
    syntaxString: '#a31515',
    syntaxComment: '#008000',
    syntaxNumber: '#098658',
    syntaxType: '#267f99',
    syntaxFunction: '#795e26',
    syntaxConstant: '#0070c1',
    syntaxProperty: '#001080',
  },
  /**
   * Xcode Dark — Apple
   * @see https://developer.apple.com/xcode
   */
  'xcode-dark': {
    accent: '#5dd8ff',
    border: '#313131',
    danger: '#fc3d39',
    focusBorder: '#5dd8ff',
    gitAdded: '#48ca49',
    gitDeleted: '#fc3d39',
    gitModified: '#ffbf00',
    info: '#5dd8ff',
    muted: '#6c7986',
    selection: '#646f83',
    success: '#48ca49',
    warning: '#ffbf00',
    syntaxKeyword: '#fc5fa3',
    syntaxString: '#fc6a5d',
    syntaxComment: '#6c7986',
    syntaxNumber: '#d9c97c',
    syntaxType: '#5dd8ff',
    syntaxFunction: '#67b7a4',
    syntaxConstant: '#d9c97c',
    syntaxProperty: '#41a1c0',
  },
  /**
   * Xcode Light — Apple
   * @see https://developer.apple.com/xcode
   */
  'xcode-light': {
    accent: '#0b4f79',
    border: '#d8dde3',
    danger: '#d12f1b',
    focusBorder: '#0b4f79',
    gitAdded: '#3e8d2e',
    gitDeleted: '#d12f1b',
    gitModified: '#b06e00',
    info: '#0b4f79',
    muted: '#8c97a0',
    selection: '#b5d5fd',
    success: '#3e8d2e',
    warning: '#b06e00',
    syntaxKeyword: '#ad3da4',
    syntaxString: '#c41a16',
    syntaxComment: '#5d6c79',
    syntaxNumber: '#1c00cf',
    syntaxType: '#703daa',
    syntaxFunction: '#23575c',
    syntaxConstant: '#1c00cf',
    syntaxProperty: '#26474b',
  },
  /**
   * Sublime Mariana — Sublimehq
   * @see https://www.sublimetext.com
   */
  'sublime-mariana': {
    accent: '#6699cc',
    border: '#1f2b38',
    danger: '#ec5f67',
    focusBorder: '#5fb3b3',
    gitAdded: '#99c794',
    gitDeleted: '#ec5f67',
    gitModified: '#fac863',
    info: '#6699cc',
    muted: '#626d7a',
    selection: '#2d4e69',
    success: '#99c794',
    warning: '#fac863',
    syntaxKeyword: '#c594cf',
    syntaxString: '#99c794',
    syntaxComment: '#626d7a',
    syntaxNumber: '#f99157',
    syntaxType: '#fac863',
    syntaxFunction: '#6699cc',
    syntaxConstant: '#f99157',
    syntaxProperty: '#5fb3b3',
  },
  /**
   * GitHub Dark High Contrast — GitHub
   * @see https://github.com/primer/github-vscode-theme
   */
  'github-dark-high-contrast': {
    accent: '#71b7ff',
    border: '#21262d',
    danger: '#ff9492',
    focusBorder: '#71b7ff',
    gitAdded: '#7ce38b',
    gitDeleted: '#ff9492',
    gitModified: '#ffdf5d',
    info: '#71b7ff',
    muted: '#7d8590',
    selection: '#143d79',
    success: '#7ce38b',
    warning: '#ffdf5d',
    syntaxKeyword: '#ff7b72',
    syntaxString: '#96d0ff',
    syntaxComment: '#8b949e',
    syntaxNumber: '#79c0ff',
    syntaxType: '#ffa657',
    syntaxFunction: '#d2a8ff',
    syntaxConstant: '#79c0ff',
    syntaxProperty: '#79c0ff',
  },
  /**
   * Noctis — liviuschera
   * @see https://github.com/liviuschera/noctis
   */
  noctis: {
    accent: '#2bbbad',
    border: '#1b2932',
    danger: '#ef4050',
    focusBorder: '#2bbbad',
    gitAdded: '#49e9a6',
    gitDeleted: '#ef4050',
    gitModified: '#f5d67d',
    info: '#76b9ed',
    muted: '#475d62',
    selection: '#253b47',
    success: '#49e9a6',
    warning: '#f5d67d',
    syntaxKeyword: '#ff0e83',
    syntaxString: '#86d3a7',
    syntaxComment: '#475d62',
    syntaxNumber: '#f5d67d',
    syntaxType: '#2bbbad',
    syntaxFunction: '#76b9ed',
    syntaxConstant: '#ff9d00',
    syntaxProperty: '#e4f2f7',
  },
  /**
   * Shades of Purple — Ahmad Awais
   * @see https://github.com/ahmadawais/shades-of-purple-vscode
   */
  'shades-of-purple': {
    accent: '#fad000',
    border: '#3d3c6e',
    danger: '#ff628c',
    focusBorder: '#fb94ff',
    gitAdded: '#a5ff90',
    gitDeleted: '#ff628c',
    gitModified: '#ffd700',
    info: '#9effff',
    muted: '#848396',
    selection: '#a599e9',
    success: '#a5ff90',
    warning: '#ffd700',
    syntaxKeyword: '#ff9d00',
    syntaxString: '#fad000',
    syntaxComment: '#b362ff',
    syntaxNumber: '#ff628c',
    syntaxType: '#fb94ff',
    syntaxFunction: '#fad000',
    syntaxConstant: '#ff9d00',
    syntaxProperty: '#9effff',
  },
  /**
   * Winter is Coming — John Papa
   * @see https://github.com/johnpapa/vscode-winteriscoming
   */
  'winter-is-coming': {
    accent: '#82aaff',
    border: '#011e3a',
    danger: '#ff2c6d',
    focusBorder: '#7fdbca',
    gitAdded: '#addb67',
    gitDeleted: '#ff2c6d',
    gitModified: '#ecc48d',
    info: '#82aaff',
    muted: '#637777',
    selection: '#0a2533',
    success: '#addb67',
    warning: '#ecc48d',
    syntaxKeyword: '#c792ea',
    syntaxString: '#addb67',
    syntaxComment: '#637777',
    syntaxNumber: '#f78c6c',
    syntaxType: '#ffcb8b',
    syntaxFunction: '#82aaff',
    syntaxConstant: '#7fdbca',
    syntaxProperty: '#7fdbca',
  },
  /**
   * Tomorrow Night Bright — Chris Kempson
   * @see https://github.com/chriskempson/tomorrow-theme
   */
  'tomorrow-night-bright': {
    accent: '#7aa6da',
    border: '#373b41',
    danger: '#d54e53',
    focusBorder: '#70c0b1',
    gitAdded: '#b9ca4a',
    gitDeleted: '#d54e53',
    gitModified: '#e7c547',
    info: '#7aa6da',
    muted: '#969896',
    selection: '#2a2a2a',
    success: '#b9ca4a',
    warning: '#e78c45',
    syntaxKeyword: '#d54e53',
    syntaxString: '#b9ca4a',
    syntaxComment: '#969896',
    syntaxNumber: '#e78c45',
    syntaxType: '#c397d8',
    syntaxFunction: '#7aa6da',
    syntaxConstant: '#c397d8',
    syntaxProperty: '#70c0b1',
  },
  /**
   * Tomorrow Night Eighties — Chris Kempson
   * @see https://github.com/chriskempson/tomorrow-theme
   */
  'tomorrow-night-eighties': {
    accent: '#6699cc',
    border: '#515151',
    danger: '#f2777a',
    focusBorder: '#66cccc',
    gitAdded: '#99cc99',
    gitDeleted: '#f2777a',
    gitModified: '#ffcc66',
    info: '#6699cc',
    muted: '#999999',
    selection: '#393939',
    success: '#99cc99',
    warning: '#f99157',
    syntaxKeyword: '#cc99cc',
    syntaxString: '#99cc99',
    syntaxComment: '#999999',
    syntaxNumber: '#f99157',
    syntaxType: '#ffcc66',
    syntaxFunction: '#6699cc',
    syntaxConstant: '#f2777a',
    syntaxProperty: '#66cccc',
  },
  /**
   * Molokai — Tomas Restrepo
   * @see https://github.com/tomasr/molokai
   */
  molokai: {
    accent: '#66d9ef',
    border: '#2d2e2e',
    danger: '#f92672',
    focusBorder: '#66d9ef',
    gitAdded: '#a6e22e',
    gitDeleted: '#f92672',
    gitModified: '#e6db74',
    info: '#66d9ef',
    muted: '#7e8e91',
    selection: '#403d3d',
    success: '#a6e22e',
    warning: '#e6db74',
    syntaxKeyword: '#f92672',
    syntaxString: '#e6db74',
    syntaxComment: '#7e8e91',
    syntaxNumber: '#ae81ff',
    syntaxType: '#66d9ef',
    syntaxFunction: '#a6e22e',
    syntaxConstant: '#ae81ff',
    syntaxProperty: '#66d9ef',
  },
  /**
   * Jellybeans — nanotech
   * @see https://github.com/nanotech/jellybeans.vim
   */
  jellybeans: {
    accent: '#8197bf',
    border: '#262626',
    danger: '#cf6a4c',
    focusBorder: '#7ccd7c',
    gitAdded: '#99ad6a',
    gitDeleted: '#cf6a4c',
    gitModified: '#fad07a',
    info: '#8197bf',
    muted: '#888888',
    selection: '#4a4a59',
    success: '#99ad6a',
    warning: '#fad07a',
    syntaxKeyword: '#8197bf',
    syntaxString: '#99ad6a',
    syntaxComment: '#888888',
    syntaxNumber: '#cf6a4c',
    syntaxType: '#fad07a',
    syntaxFunction: '#fad07a',
    syntaxConstant: '#cf6a4c',
    syntaxProperty: '#c6b6ee',
  },
  /**
   * Railscasts — Ryan Bates
   * @see https://github.com/ryanb/textmate-themes
   */
  railscasts: {
    accent: '#ffc66d',
    border: '#353535',
    danger: '#da4939',
    focusBorder: '#ffc66d',
    gitAdded: '#a5c261',
    gitDeleted: '#da4939',
    gitModified: '#ffc66d',
    info: '#6d9cbe',
    muted: '#bc9458',
    selection: '#494847',
    success: '#a5c261',
    warning: '#cc7833',
    syntaxKeyword: '#cc7833',
    syntaxString: '#a5c261',
    syntaxComment: '#bc9458',
    syntaxNumber: '#d0d0ff',
    syntaxType: '#da4939',
    syntaxFunction: '#ffc66d',
    syntaxConstant: '#6d9cbe',
    syntaxProperty: '#d0d0ff',
  },
  /**
   * Spacegray — kkga
   * @see https://github.com/kkga/spacegray
   */
  spacegray: {
    accent: '#5486c0',
    border: '#383d4a',
    danger: '#bf616a',
    focusBorder: '#5fb3b3',
    gitAdded: '#96b5b4',
    gitDeleted: '#bf616a',
    gitModified: '#ebcb8b',
    info: '#5486c0',
    muted: '#6c7a96',
    selection: '#2e3443',
    success: '#96b5b4',
    warning: '#ebcb8b',
    syntaxKeyword: '#c59bc1',
    syntaxString: '#8fa1b3',
    syntaxComment: '#6c7a96',
    syntaxNumber: '#d08770',
    syntaxType: '#ebcb8b',
    syntaxFunction: '#96b5b4',
    syntaxConstant: '#5486c0',
    syntaxProperty: '#8fa1b3',
  },
  /**
   * Srcery — roosta
   * @see https://github.com/srcery-colors/srcery-vim
   */
  srcery: {
    accent: '#0aaeb3',
    border: '#2d2b28',
    danger: '#ef2f27',
    focusBorder: '#53fde9',
    gitAdded: '#519f50',
    gitDeleted: '#ef2f27',
    gitModified: '#fbb829',
    info: '#2c78bf',
    muted: '#918175',
    selection: '#2d2b28',
    success: '#519f50',
    warning: '#fbb829',
    syntaxKeyword: '#ef2f27',
    syntaxString: '#98bc37',
    syntaxComment: '#918175',
    syntaxNumber: '#fed06e',
    syntaxType: '#68a8e4',
    syntaxFunction: '#53fde9',
    syntaxConstant: '#ff5c8f',
    syntaxProperty: '#0aaeb3',
  },
  /**
   * Alabaster — Nikita Prokopov
   * @see https://github.com/tonsky/sublime-scheme-alabaster
   */
  alabaster: {
    accent: '#7600ff',
    border: '#e0e0e0',
    danger: '#c41e3a',
    focusBorder: '#7600ff',
    gitAdded: '#448c27',
    gitDeleted: '#c41e3a',
    gitModified: '#9c5d27',
    info: '#4b69c6',
    muted: '#aaaaaa',
    selection: '#d4e8fd',
    success: '#448c27',
    warning: '#9c5d27',
    syntaxKeyword: '#7600ff',
    syntaxString: '#448c27',
    syntaxComment: '#aaaaaa',
    syntaxNumber: '#9c5d27',
    syntaxType: '#7600ff',
    syntaxFunction: '#4b69c6',
    syntaxConstant: '#7600ff',
    syntaxProperty: '#1c1c1c',
  },
  /**
   * Challenger Deep — Nimit Kalra
   * @see https://github.com/challenger-deep-theme/vim
   */
  'challenger-deep': {
    accent: '#aaffe4',
    border: '#565575',
    danger: '#ff5458',
    focusBorder: '#62d196',
    gitAdded: '#95ffa4',
    gitDeleted: '#ff5458',
    gitModified: '#ffe9aa',
    info: '#aaffe4',
    muted: '#565575',
    selection: '#2b2a3e',
    success: '#95ffa4',
    warning: '#ffe9aa',
    syntaxKeyword: '#ff8080',
    syntaxString: '#95ffa4',
    syntaxComment: '#565575',
    syntaxNumber: '#aaffe4',
    syntaxType: '#ffe9aa',
    syntaxFunction: '#62d196',
    syntaxConstant: '#ff5458',
    syntaxProperty: '#cbe3e7',
  },
  /**
   * Moonfly — bluz71
   * @see https://github.com/bluz71/vim-moonfly-colors
   */
  moonfly: {
    accent: '#80a0ff',
    border: '#1c1c1c',
    danger: '#ff5189',
    focusBorder: '#79dac8',
    gitAdded: '#8cc85f',
    gitDeleted: '#ff5189',
    gitModified: '#e3c78a',
    info: '#80a0ff',
    muted: '#717171',
    selection: '#1c1c1c',
    success: '#8cc85f',
    warning: '#e3c78a',
    syntaxKeyword: '#80a0ff',
    syntaxString: '#e3c78a',
    syntaxComment: '#717171',
    syntaxNumber: '#f09479',
    syntaxType: '#79dac8',
    syntaxFunction: '#80a0ff',
    syntaxConstant: '#d183e8',
    syntaxProperty: '#79dac8',
  },
}
