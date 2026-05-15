import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: 'Reygent',
  description: 'Agentic coding tool for software development',
  base: '/reygent/', // Remove base for custom domain, uncomment for GitHub Pages default

  themeConfig: {
    logo: '/ReygentLogo.png',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/quickstart' },
      { text: 'Chesstrace', link: '/chesstrace' },
      { text: 'GitHub', link: 'https://github.com/andrewevans0102/reygent' }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Quick Start', link: '/quickstart' }
        ]
      },
      {
        text: 'Core Concepts',
        items: [
          { text: 'Agents', link: '/agents' },
          { text: 'Commands', link: '/commands' },
          { text: 'Providers', link: '/providers' },
          { text: 'Workflows', link: '/workflows' }
        ]
      },
      {
        text: 'Features',
        collapsed: false,
        items: [
          { text: 'Knowledge System', link: '/knowledge' },
          { text: 'Telemetry', link: '/telemetry' },
          { text: 'Chesstrace', link: '/chesstrace' }
        ]
      },
      {
        text: 'Advanced',
        collapsed: true,
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Provider Adapters', link: '/provider-adapters' },
          { text: 'Harness Pattern', link: '/harness-pattern' },
          { text: 'Skills', link: '/skills' }
        ]
      },
      {
        text: 'Reference',
        collapsed: true,
        items: [
          { text: 'Pricing Verification', link: '/verify-pricing' },
          { text: 'Usage Tracking', link: '/usage-tracking' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/andrewevans0102/reygent' }
    ],

    footer: {
      message: 'Released under the Apache-2.0 License.',
      copyright: 'Copyright © 2024-present'
    },

    search: {
      provider: 'local'
    }
  },

  markdown: {
    config: (md) => {
      // Mermaid support enabled via vitepress-plugin-mermaid
    }
  },

  mermaid: {
    // Mermaid config options
  }
}))
