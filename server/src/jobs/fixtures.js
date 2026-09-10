// Offline job corpus — the default JOBS_PROVIDER.
//
// Serves two purposes. It makes the whole app runnable with no API key, and it
// is the background corpus TF-IDF fits against: IDF computed over three or four
// documents is meaningless (every shared term looks equally common), so these
// postings give term weights something realistic to calibrate against.

export const FIXTURE_JOBS = [
  {
    external_id: 'fx-001', title: 'Backend Engineer', company: 'Northwind Systems',
    location: 'New York, NY', salary_min: 115000, salary_max: 155000,
    url: 'https://example.com/jobs/fx-001',
    description: `Design and maintain backend services in Python and Go. You will build REST APIs,
      optimize PostgreSQL queries, and operate services on AWS with Docker and Kubernetes.
      Experience with distributed systems, Redis caching, message queues such as Kafka, and
      monitoring and alerting is required. You will participate in code review, work in an agile
      sprint cadence, and collaborate with product managers on the roadmap.`,
  },
  {
    external_id: 'fx-002', title: 'Full Stack Developer', company: 'Brightpath Labs',
    location: 'Remote', salary_min: 100000, salary_max: 140000,
    url: 'https://example.com/jobs/fx-002',
    description: `Build React frontends and Node.js and Express backends. Work with MySQL and
      MongoDB, write unit and integration tests, and deploy through CI/CD pipelines. Familiarity
      with TypeScript, GraphQL, Docker, and AWS is valued. Strong communication and teamwork
      are essential as you will collaborate with designers and stakeholders on requirements.`,
  },
  {
    external_id: 'fx-003', title: 'Machine Learning Engineer', company: 'Cobalt AI',
    location: 'San Francisco, CA', salary_min: 140000, salary_max: 195000,
    url: 'https://example.com/jobs/fx-003',
    description: `Train and deploy deep learning models with PyTorch and TensorFlow. Strong
      statistics, natural language processing, and Python required, with pandas, numpy, and
      scikit-learn. You will run distributed training, build data pipelines with Airflow and
      Spark, and deploy models to production on Kubernetes. Publish findings and mentor juniors.`,
  },
  {
    external_id: 'fx-004', title: 'Data Analyst', company: 'Meridian Retail',
    location: 'Chicago, IL', salary_min: 75000, salary_max: 100000,
    url: 'https://example.com/jobs/fx-004',
    description: `Analyze sales and customer data using SQL and Excel. Build dashboards in Tableau
      and Power BI, report KPIs and metrics to stakeholders, and support forecasting and budget
      planning. Python with pandas for analysis is a plus. Strong analytical and critical thinking
      skills, attention to detail, and clear written communication are essential.`,
  },
  {
    external_id: 'fx-005', title: 'DevOps Engineer', company: 'Ironclad Cloud',
    location: 'Austin, TX', salary_min: 120000, salary_max: 165000,
    url: 'https://example.com/jobs/fx-005',
    description: `Own infrastructure as code with Terraform and Ansible. Manage Kubernetes clusters
      on AWS and GCP, maintain Jenkins and CI/CD pipelines, and improve reliability, availability,
      and latency. Experience with Linux, bash scripting, monitoring, incident response, and
      on-call rotation required. You will run postmortems and drive scalability improvements.`,
  },
  {
    external_id: 'fx-006', title: 'Frontend Engineer', company: 'Lumen Design Co',
    location: 'Remote', salary_min: 95000, salary_max: 135000,
    url: 'https://example.com/jobs/fx-006',
    description: `Build accessible, responsive interfaces with React and TypeScript. Strong HTML,
      CSS, and JavaScript fundamentals required. Work with Next.js, webpack, and design systems in
      Figma. You will write unit tests, participate in code review, and collaborate closely with
      designers and product managers. Attention to detail and clear communication matter here.`,
  },
  {
    external_id: 'fx-007', title: 'Software Engineering Intern', company: 'Northwind Systems',
    location: 'New York, NY', salary_min: 30, salary_max: 45,
    url: 'https://example.com/jobs/fx-007',
    description: `Summer internship for computer science students. You will write Python or
      JavaScript, learn Git and code review, build small REST API features, and write unit tests.
      Exposure to SQL databases and Linux is helpful. We look for curiosity, problem solving,
      and the initiative to ask questions. No professional experience required.`,
  },
  {
    external_id: 'fx-008', title: 'Mobile Engineer (React Native)', company: 'Waypoint Health',
    location: 'Boston, MA', salary_min: 110000, salary_max: 150000,
    url: 'https://example.com/jobs/fx-008',
    description: `Build cross-platform mobile applications in React Native for iOS and Android.
      Strong JavaScript and TypeScript required. Integrate REST APIs, manage offline state, and
      optimize performance. Experience with native modules, Swift or Kotlin, and app store
      deployment is a plus. Collaborate with designers on Figma specifications.`,
  },
  {
    external_id: 'fx-009', title: 'Security Engineer', company: 'Bastion Financial',
    location: 'New York, NY', salary_min: 130000, salary_max: 180000,
    url: 'https://example.com/jobs/fx-009',
    description: `Secure cloud infrastructure and applications. Work on authentication,
      authorization, encryption, and networking controls. Conduct code review for vulnerabilities,
      run audits for compliance, and respond to incidents. Experience with Linux, Python scripting,
      AWS security tooling, and threat modeling required. Clear documentation is essential.`,
  },
  {
    external_id: 'fx-010', title: 'Product Manager, Platform', company: 'Brightpath Labs',
    location: 'Remote', salary_min: 125000, salary_max: 170000,
    url: 'https://example.com/jobs/fx-010',
    description: `Own the platform roadmap. Gather requirements from stakeholders, write
      specifications, and prioritize the backlog across agile sprints. Partner with engineering
      and design on architecture and design review. Analyze metrics and KPIs to inform decisions.
      Excellent communication, negotiation, and presentation skills required.`,
  },
  {
    external_id: 'fx-011', title: 'Data Engineer', company: 'Cobalt AI',
    location: 'Seattle, WA', salary_min: 125000, salary_max: 170000,
    url: 'https://example.com/jobs/fx-011',
    description: `Build and maintain ETL pipelines with Airflow, Spark, and Kafka. Model data in
      Snowflake and PostgreSQL, and optimize query performance and indexing. Strong Python and SQL
      required. Work with Docker, Kubernetes, and Terraform on AWS. You will partner with analysts
      and machine learning engineers to make data reliable and available.`,
  },
  {
    external_id: 'fx-012', title: 'QA Automation Engineer', company: 'Waypoint Health',
    location: 'Boston, MA', salary_min: 90000, salary_max: 125000,
    url: 'https://example.com/jobs/fx-012',
    description: `Design automated test suites for web and mobile. Write unit, integration, and
      end-to-end tests in JavaScript or Python. Maintain CI/CD test stages in Jenkins, triage
      failures, and drive debugging with engineers. Experience with REST API testing, Postman,
      and performance profiling required. Detail oriented and organized.`,
  },
  {
    external_id: 'fx-013', title: 'Site Reliability Engineer', company: 'Ironclad Cloud',
    location: 'Remote', salary_min: 135000, salary_max: 185000,
    url: 'https://example.com/jobs/fx-013',
    description: `Keep production reliable at scale. Own monitoring, alerting, and incident
      response, and run blameless postmortems. Improve latency, throughput, and availability of
      distributed systems. Deep Linux, Kubernetes, and Terraform experience required, with Go or
      Python for tooling. On-call rotation shared across the team.`,
  },
  {
    external_id: 'fx-014', title: 'Junior Software Developer', company: 'Meridian Retail',
    location: 'Chicago, IL', salary_min: 70000, salary_max: 95000,
    url: 'https://example.com/jobs/fx-014',
    description: `Entry-level role building internal web tools. Write JavaScript and Python, work
      with MySQL, and learn Git workflows and code review. You will fix bugs, add small features,
      and write unit tests alongside a mentor. We value curiosity, accountability, and clear
      communication over prior professional experience.`,
  },
  {
    external_id: 'fx-015', title: 'Cloud Solutions Architect', company: 'Bastion Financial',
    location: 'New York, NY', salary_min: 150000, salary_max: 205000,
    url: 'https://example.com/jobs/fx-015',
    description: `Design cloud architecture for regulated financial workloads. Lead architecture
      and design review, model scalability and reliability tradeoffs, and guide teams on AWS and
      Azure. Deep experience with microservices, networking, encryption, and compliance audit
      requirements. Present designs to stakeholders and mentor engineers.`,
  },
];

/** Normalize whitespace so stored descriptions are not full of source indentation. */
function clean(job) {
  return { ...job, source: 'fixtures', description: job.description.replace(/\s+/g, ' ').trim() };
}

/** Keyword search over the fixture set, mimicking a job API's query semantics. */
export function searchFixtures({ query = '', location = '', limit = 20 } = {}) {
  const q = query.toLowerCase().trim();
  const loc = location.toLowerCase().trim();

  const matches = FIXTURE_JOBS.filter((job) => {
    const haystack = `${job.title} ${job.company} ${job.description}`.toLowerCase();
    const matchesQuery = !q || q.split(/\s+/).every((word) => haystack.includes(word));
    const matchesLocation = !loc || job.location.toLowerCase().includes(loc);
    return matchesQuery && matchesLocation;
  });

  return matches.slice(0, limit).map(clean);
}

/** Every fixture description — the background corpus for IDF fitting. */
export function corpusTexts() {
  return FIXTURE_JOBS.map((job) => job.description.replace(/\s+/g, ' ').trim());
}
