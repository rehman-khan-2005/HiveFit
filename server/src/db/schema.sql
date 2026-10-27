-- HiveFit schema — implements the Entity Relationship Diagram (Figure 5).
--
-- Entities:  User, Resume, JobPosting, ATSAnalysis, Suggestion, SavedJob
-- Relations: User 1:N Resume, User 1:N SavedJob, Resume 1:N ATSAnalysis,
--            JobPosting 1:N ATSAnalysis, JobPosting 1:N SavedJob,
--            ATSAnalysis 1:N Suggestion.
--
-- ATSAnalysis resolves the many-to-many between Resume and JobPosting: a
-- resume can be scored against many postings, and a posting can be scored
-- against many resumes. That is what makes multi-job comparison possible.

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(120),
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resumes (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  title       VARCHAR(200) NOT NULL,
  file_name   VARCHAR(255),
  file_type   ENUM('pdf','txt') NOT NULL DEFAULT 'txt',
  raw_text    MEDIUMTEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_resume_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_resume_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS job_postings (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source        VARCHAR(40)  NOT NULL DEFAULT 'manual',  -- adzuna | muse | fixtures | manual
  external_id   VARCHAR(120),
  title         VARCHAR(255) NOT NULL,
  company       VARCHAR(255),
  location      VARCHAR(255),
  description   MEDIUMTEXT NOT NULL,
  salary_min    DECIMAL(12,2),
  salary_max    DECIMAL(12,2),
  url           VARCHAR(1000),
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Listing lifecycle. Job boards are a moving target: postings appear, get
  -- filled, and are pulled. Without these the pool only ever grows, and a
  -- resume analysed on Monday and again on Thursday sees an identical, ever-
  -- staler set of jobs.
  -- Where the job is, for the map view. Nullable throughout: plenty of
  -- postings are remote, or name a place no gazetteer resolves.
  latitude      DECIMAL(9,6) NULL,
  longitude     DECIMAL(9,6) NULL,
  geo_source    VARCHAR(20) NULL,   -- provider | gazetteer | none
  posted_at     DATETIME NULL,      -- publication date, when the board states one
  closes_at     DATETIME NULL,      -- stated application deadline, when a board gives one
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expired_at    DATETIME NULL,      -- inferred gone: sweeps stopped returning it
  -- Confirmed gone by fetching the listing itself. Separate from expired_at
  -- because a re-sighting clears that one, and a board that keeps serving a
  -- dead listing would otherwise resurrect it on every single sweep.
  unavailable_at DATETIME NULL,
  checked_at    DATETIME NULL,      -- last liveness check, so checks round-robin
  UNIQUE KEY uq_posting_source (source, external_id),
  INDEX idx_posting_title (title),
  INDEX idx_posting_active (expired_at, last_seen_at),
  INDEX idx_posting_checked (unavailable_at, checked_at),
  -- Bounding-box lookups for the map pan over the stored pool.
  INDEX idx_posting_geo (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ats_analyses (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resume_id       INT UNSIGNED NOT NULL,
  job_posting_id  INT UNSIGNED NOT NULL,
  score           DECIMAL(5,2) NOT NULL,          -- headline: IDF-weighted requirement coverage
  retrieval       DECIMAL(5,2) NULL,              -- BM25, reported alongside for comparison
  similarity      DECIMAL(5,2) NULL,              -- raw TF-IDF cosine from stage 2.4
  category_scores JSON NOT NULL,                  -- per-category transparency breakdown
  keyword_gap     JSON NOT NULL,                  -- missing terms grouped by category
  underhighlighted JSON NULL,                     -- requirements met but not demonstrated
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_analysis_resume  FOREIGN KEY (resume_id)      REFERENCES resumes(id)      ON DELETE CASCADE,
  CONSTRAINT fk_analysis_posting FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE CASCADE,
  INDEX idx_analysis_resume (resume_id),
  INDEX idx_analysis_posting (job_posting_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS suggestions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ats_analysis_id INT UNSIGNED NOT NULL,
  original_text   TEXT NOT NULL,
  suggested_text  TEXT,
  -- 'needs_input' is the honest-AI state: a gap was found and we asked the
  -- user whether the experience is real before writing anything.
  status          ENUM('needs_input','suggested','accepted','discarded')
                    NOT NULL DEFAULT 'suggested',
  prompt_question TEXT,
  accepted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_suggestion_analysis FOREIGN KEY (ats_analysis_id) REFERENCES ats_analyses(id) ON DELETE CASCADE,
  INDEX idx_suggestion_analysis (ats_analysis_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS saved_jobs (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED NOT NULL,
  job_posting_id INT UNSIGNED NOT NULL,
  status         ENUM('Saved','Applied','Interview','Offer','Rejected') NOT NULL DEFAULT 'Saved',
  notes          TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_saved_user    FOREIGN KEY (user_id)        REFERENCES users(id)         ON DELETE CASCADE,
  CONSTRAINT fk_saved_posting FOREIGN KEY (job_posting_id) REFERENCES job_postings(id)  ON DELETE CASCADE,
  UNIQUE KEY uq_saved_user_posting (user_id, job_posting_id),
  INDEX idx_saved_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
