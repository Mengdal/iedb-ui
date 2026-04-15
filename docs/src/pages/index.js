import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const highlights = [
  {
    title: '极致写入性能',
    description: '列式 MessagePack 写入，吞吐可达 1800 万条/秒，适配海量实时数据场景。',
  },
  {
    title: '高速 SQL 分析',
    description: '基于 DuckDB 引擎，查询吞吐可达 600 万行/秒，支持标准 SQL、窗口函数与 CTE。',
  },
  {
    title: '开放存储与低成本',
    description: '原生 Parquet + S3/MinIO/本地存储，数据不被专有格式锁定，长期可迁移。',
  },
  {
    title: '面向生产可观测',
    description: '支持 WAL、保留策略、连续查询、审计日志与 RBAC，满足企业级稳定性与合规要求。',
  },
];

const scenarios = [
  '可观测性日志与指标分析',
  '物联网与工业遥测数据平台',
  'AI/ML 训练与推理数据分析',
  '产品行为分析与增长分析',
];

function HomepageHeader() {
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <p className={styles.badge}>AI-Powered 高性能分析型数据库</p>
        <Heading as="h1" className="hero__title">
          IotEdgeDB
        </Heading>
        <p className="hero__subtitle">
          基于 DuckDB 与 Parquet 构建，兼具高吞吐写入、亚秒级查询与开放存储架构。
        </p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/欢迎页">
            立即开始
          </Link>
          <Link className="button button--outline button--lg" to="/docs/快速上手">
            5 分钟快速上手
          </Link>
        </div>
      </div>
    </header>
  );
}

function HighlightSection() {
  return (
    <section className={styles.section}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          为什么选择 IotEdgeDB
        </Heading>
        <div className={styles.grid}>
          {highlights.map((item) => (
            <article key={item.title} className={styles.card}>
              <Heading as="h3">{item.title}</Heading>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ScenarioSection() {
  return (
    <section className={styles.sectionAlt}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          典型应用场景
        </Heading>
        <ul className={styles.scenarioList}>
          {scenarios.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <div className={styles.ctaWrap}>
          <Link className="button button--primary button--lg" to="/docs/API参考">
            查看 API 参考
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();

  return (
    <Layout
      title={``}
      description="IotEdgeDB 文档站：高性能写入、标准 SQL 查询、开放 Parquet 存储与企业级数据治理能力。">
      <HomepageHeader />
      <main>
        <HighlightSection />
        <ScenarioSection />
      </main>
    </Layout>
  );
}
