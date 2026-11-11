# OpenUI Live Replies

A [bb](https://getbb.app) plugin that lets agents answer with live UI: [OpenUI Lang](https://www.openui.com) blocks drawn inline in chat as cards, charts, tables, forms and more. Buttons and forms send the user's answer back into the thread.

See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for what it does, its requirements, and its costs.

<!-- VIDEO: open this file in GitHub's web editor and drag your .mp4 onto the line below.
     GitHub uploads it and replaces it with a https://github.com/user-attachments/assets/... link,
     which renders as an inline player. Delete this comment afterwards. -->
<!-- video goes here -->

## Screenshots

Everything below is a real reply in bb, rendered by this plugin.

**Dashboards**: gauges and charts from numbers the agent already has.

![Service health dashboard with gauges and a latency chart](docs/screenshots/dashboard.png)

**Reports**: test runs with failures first, file and line.

![Test results report](docs/screenshots/tests.png)

**Diagrams**: flows drawn from Mermaid.

![Flow diagram of how a reply becomes UI](docs/screenshots/diagram.png)

**Decisions you can click**: re-weight criteria live, then send the pick back to the agent.

![Weighted decision between three job queues](docs/screenshots/decision.png)

<!-- More screenshots: save a PNG under docs/screenshots/ and add a line like
![What it shows](docs/screenshots/your-image.png) -->

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
