# OpenUI Live Replies

A [bb](https://getbb.app) plugin that lets agents answer with live UI: [OpenUI Lang](https://www.openui.com) blocks drawn inline in chat as cards, charts, tables, forms and more. Buttons and forms send the user's answer back into the thread.

See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for what it does, its requirements, and its costs.

## Install

Add this repo as a marketplace, then install from it:

```sh
bb marketplace add git:github.com/ahsan7162/bb-plugin-openui@main
bb plugin install openui@ahsan7162
```

Or install it directly:

```sh
bb plugin install git:github.com/ahsan7162/bb-plugin-openui@main
```

## Develop

```sh
npm install
bb plugin install .   # register this checkout
bb plugin dev         # rebuild and reload on save
npm test
```
