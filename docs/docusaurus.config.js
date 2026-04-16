// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'IotEdge DB',
  tagline: 'LMGateay',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: 'http://docs.lmgateway.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'Mengdal', // Usually your GitHub org/user name.
  projectName: 'iedb-ui', // Usually your repo name.
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans']
  },

  headTags: [
    {
      tagName: 'meta',
      attributes: {
        name: 'algolia-site-verification',
        content: 'D994DAC8B458F9E2',
      },
    },
  ],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          // includeCurrentVersion: false,
          sidebarPath: './sidebars.js',
          versions: {
            current: { label: 'Latest' }, // 原来默认显示 Next
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/Mengdal/iedb-ui/tree/main/docs/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/Mengdal/iedb-ui/tree/main/docs/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Replace with your project's social card
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      algolia: {
        appId: '9S9WHWNB0C',
        apiKey: '601f4a20f0164653cb4be4b4bc96c9b3',
        indexName: 'docs',
        contextualSearch: false,
        searchParameters: {
          // 按“页面”去重：同一页面的不同段落/锚点不会无限堆叠成上百条
          distinct: 1,
        },
      },
      navbar: {
        title: 'IotEdge DB',
        logo: {
          alt: '高性能列式分析型数据库',
          src: 'img/logo.png',
        },
        items: [
          {type: 'search', position: 'left'},
          {
            type: 'docsVersionDropdown',
            position: 'right', // 放在导航栏右侧
          },
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: '教程',
          },
          {to: '/blog', label: '博客', position: 'left'},
          {
            href: 'https://www.lmgateway.com/',
            label: 'Website',
            position: 'right',
          },
          // {
          //   href: 'https://github.com/Mengdal/iedb-ui',
          //   label: 'GitHub',
          //   position: 'right',
          // },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: '关于罗米',
            items: [
              {
                html: '罗米成立于2011年，是一家专注数据采集产品研发、生产的高新技术企业。致力于为工业物联网(IoT)领域提供可靠的数据采集、存储与显示方案。',
              },
            ],
          },
          {
            title: '联系我们',
            items: [
              {
                html: `
<div style="display:flex;flex-direction:column;gap:8px;line-height:1.55">
  <div>咨询：+86 180 4904 0679</div>
  <div>商务：+86 180 5592 6204</div>
  <div>产品：+86 180 5590 8530</div>
  <div>邮箱：support@lmgateway.com</div>
</div>
                `.trim(),
              },
            ],
          },
          {
            title: '关注罗米',
            items: [
              {
                label: 'Bilibili',
                href: 'https://space.bilibili.com/3546680242735557?spm_id_from=333.1007.0.0',
              },
              {
                label: '抖音',
                href: 'https://www.douyin.com/user/self?from_tab_name=main',
              },
              {
                label: 'YouTube',
                href: 'https://www.youtube.com/@LMGateway',
              },
              {
                label: 'LinkedIn',
                href: 'https://www.linkedin.com/company/lmgateway',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: '官网',
                href: 'https://www.lmgateway.com/',
              },
              {
                label: 'Blog',
                to: '/blog',
              },
              {
                label: 'GitHub',
                href: 'https://github.com/Mengdal/iedb-ui',
              },
              {
                label: 'ThingsIot',
                href: 'http://things.iotddc.com/',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} LMGateway · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">皖ICP备18002019号</a>`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
