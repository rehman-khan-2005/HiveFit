// The labelled ladder the scoring is calibrated against.
//
// Shared by the calibration tests and the CLI so the numbers quoted in a
// report and the numbers a test enforces can never diverge.

export const REFERENCE_RESUME = `Software Engineering Intern
• Built REST APIs in Node.js and Express serving 10,000 daily requests
• Migrated legacy queries to indexed MySQL tables, cutting p95 latency by 40 percent
• Collaborated with designers to ship a React dashboard used by the support team
• Wrote unit tests and set up a CI/CD pipeline in GitHub Actions
Skills: JavaScript, Python, SQL, React, Node.js, Git, Linux`;

/** `expected` is the rank the pair should land in; 0 is the best match. */
export const REFERENCE_PAIRS = [
  {
    label: 'rewritten from resume', expected: 0,
    description: `Developer to build REST APIs with Node.js and Express. Work with MySQL,
      ship React interfaces, write unit tests, maintain CI/CD pipelines with GitHub
      Actions. JavaScript and SQL required.`,
  },
  {
    label: 'same field, gaps', expected: 1,
    description: `Full Stack Developer. React and Node.js front to back, REST APIs,
      relational databases, automated testing. Familiarity with TypeScript, Docker
      and GraphQL valued.`,
  },
  {
    label: 'adjacent role', expected: 2,
    description: `Backend Engineer with strong Python and SQL. Design microservices,
      work with Docker and Kubernetes on AWS, optimize database queries, caching
      with Redis, distributed systems experience required.`,
  },
  {
    label: 'unrelated field', expected: 3,
    description: `Registered Nurse for pediatric ward. Administer medication, monitor
      vitals, coordinate with physicians, maintain patient charts, BLS required.`,
  },
];
