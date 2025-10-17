const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const WORDPRESS_API_URL =
  process.env.WORDPRESS_API_URL ||
  "https://sportsnaukri.com/wp-json/wp/v2/job_listing";
const MAX_REQUESTS_PER_MINUTE =
  parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 60;

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: MAX_REQUESTS_PER_MINUTE, // limit each IP to MAX_REQUESTS_PER_MINUTE requests per windowMs
  message: {
    success: false,
    error: "Too many requests",
    message: `Rate limit exceeded. Maximum ${MAX_REQUESTS_PER_MINUTE} requests per minute allowed.`,
    retryAfter: "1 minute",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(limiter); // Apply rate limiting to all requests

// Add response time tracking for monitoring
app.use((req, res, next) => {
  const startTime = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    console.log(
      `${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`
    );
  });
  next();
});

// Helper function to extract and clean job data
function cleanJobData(job) {
  try {
    const description = stripHtmlTags(job.content?.rendered || "");

    return {
      id: job.id || null,
      slug: job.slug || null,
      title: decodeHtmlEntities(job.title?.rendered || "No title"),
      link: job.link || null,
      employer: job.metas?._job_employer_name || "Not specified",
      employerLogo: job.metas?._job_logo || null,
      employerUrl: job.metas?._job_employer_url || null,
      location: extractLocationNames(job.metas?._job_location),
      jobType: extractJobTypes(job.metas?._job_type),
      category: extractCategories(job.metas?._job_category),
      qualification: job.metas?._job_qualification || "Not specified",
      experience: job.metas?._job_experience || "Not specified",
      salary: formatSalary(job.metas?._job_salary, job.metas?._job_max_salary),
      description:
        description.substring(0, 800) + (description.length > 800 ? "..." : ""),
      postedDate: job.date
        ? new Date(job.date).toLocaleDateString("en-IN")
        : null,
      fullDescriptionUrl: job.link,
    };
  } catch (error) {
    console.error("Error cleaning job data:", error);
    return null;
  }
}

// Extract location names from the location object
function extractLocationNames(locationObj) {
  if (!locationObj || typeof locationObj !== "object") {
    return "Not specified";
  }
  const locations = Object.values(locationObj).filter(Boolean);
  return locations.length > 0 ? locations.join(", ") : "Not specified";
}

// Extract job types from the job type object
function extractJobTypes(jobTypeObj) {
  if (!jobTypeObj || typeof jobTypeObj !== "object") {
    return "Not specified";
  }
  const types = Object.values(jobTypeObj).filter(Boolean);
  return types.length > 0 ? types.join(", ") : "Not specified";
}

// Decode HTML entities
function decodeHtmlEntities(text) {
  if (!text) return text;

  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#039;": "'",
    "&#8217;": "'",
    "&#8216;": "'",
    "&#8220;": '"',
    "&#8221;": '"',
    "&#8211;": "–",
    "&#8212;": "—",
    "&nbsp;": " ",
    "&ndash;": "–",
    "&mdash;": "—",
    "&rsquo;": "'",
    "&lsquo;": "'",
    "&rdquo;": '"',
    "&ldquo;": '"',
  };

  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, "g"), char);
  }

  // Handle numeric entities
  decoded = decoded.replace(/&#(\d+);/g, (match, dec) =>
    String.fromCharCode(dec)
  );

  return decoded;
}

// Strip HTML tags from content
function stripHtmlTags(html) {
  return decodeHtmlEntities(
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Extract categories from category object
function extractCategories(categoryObj) {
  if (!categoryObj || typeof categoryObj !== "object") {
    return "Not specified";
  }
  const categories = Object.values(categoryObj).filter(Boolean);
  return categories.length > 0 ? categories.join(", ") : "Not specified";
}

// Format salary information
function formatSalary(minSalary, maxSalary) {
  // Clean up salary values
  const cleanMin = minSalary && minSalary !== "" ? minSalary.trim() : null;
  const cleanMax = maxSalary && maxSalary !== "" ? maxSalary.trim() : null;

  if (!cleanMin && !cleanMax) {
    return "Not specified";
  }

  if (cleanMin && cleanMax) {
    return `${cleanMin} - ${cleanMax}`;
  }

  return cleanMin || cleanMax || "Not specified";
}

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    service: "SportsNaukri API Middleware",
    status: "active",
    version: "1.1.0",
    environment: process.env.NODE_ENV || "development",
    rateLimit: `${MAX_REQUESTS_PER_MINUTE} requests/minute`,
    endpoints: {
      jobs: "/api/jobs",
      openapi: "/api/openapi.json",
    },
    uptime: process.uptime(),
  });
});

// Main jobs endpoint
app.get("/api/jobs", async (req, res) => {
  try {
    const {
      search,
      slug,
      per_page = 5,
      page = 1,
      location,
      job_type,
    } = req.query;

    // Build query parameters for WordPress API
    const params = {
      per_page: Math.min(parseInt(per_page) || 5, 20), // Max 20 items
      page: parseInt(page) || 1,
      _fields: "id,slug,title,link,content,metas",
    };

    // Add optional parameters
    if (search) params.search = search;
    if (slug) params.slug = slug;

    console.log(`Fetching jobs from WordPress API with params:`, params);

    // Fetch data from WordPress API
    const response = await axios.get(WORDPRESS_API_URL, {
      params,
      timeout: 10000, // 10 second timeout
    });

    // Clean and filter the data
    let jobs = response.data.map(cleanJobData).filter((job) => job !== null);

    // Apply client-side filters if needed
    if (location) {
      const locationLower = location.toLowerCase();
      jobs = jobs.filter((job) =>
        job.location.toLowerCase().includes(locationLower)
      );
    }

    if (job_type) {
      const jobTypeLower = job_type.toLowerCase();
      jobs = jobs.filter((job) =>
        job.jobType.toLowerCase().includes(jobTypeLower)
      );
    }

    // Extract pagination info from headers
    const totalJobs = response.headers["x-wp-total"] || jobs.length;
    const totalPages = response.headers["x-wp-totalpages"] || 1;

    res.json({
      success: true,
      count: jobs.length,
      total: parseInt(totalJobs),
      totalPages: parseInt(totalPages),
      currentPage: params.page,
      jobs: jobs,
    });
  } catch (error) {
    console.error("Error fetching jobs:", error.message);

    // Handle different error types
    if (error.response) {
      // WordPress API returned an error
      res.status(error.response.status).json({
        success: false,
        error: "WordPress API error",
        message: error.response.data?.message || "Failed to fetch jobs",
        statusCode: error.response.status,
      });
    } else if (error.request) {
      // Request made but no response
      res.status(503).json({
        success: false,
        error: "Service unavailable",
        message: "Could not reach WordPress API",
      });
    } else {
      // Something else went wrong
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: error.message,
      });
    }
  }
});

// OpenAPI specification endpoint
app.get("/api/openapi.json", (req, res) => {
  const host = req.get("host");
  const protocol = req.protocol;

  res.json({
    openapi: "3.1.0",
    info: {
      title: "SportsNaukri Job API Middleware",
      description:
        "Optimized API middleware that fetches and filters job listings from SportsNaukri.com. Returns only essential job data for ChatGPT integration.",
      version: "v1.0.0",
    },
    servers: [
      {
        url: `${protocol}://${host}`,
      },
    ],
    paths: {
      "/api/jobs": {
        get: {
          operationId: "getJobs",
          summary: "Fetch optimized job listings",
          description:
            "Retrieves and filters job listings from SportsNaukri.com, returning only essential fields (id, title, employer, location, job type, qualification, description summary, and link).",
          parameters: [
            {
              name: "search",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Keyword to search for jobs (e.g. coach, fitness, manager, cricket).",
            },
            {
              name: "slug",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Job slug to fetch a specific job (e.g. sports-manager-bengaluru).",
            },
            {
              name: "location",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Filter jobs by location (e.g. Mumbai, Delhi, Bangalore).",
            },
            {
              name: "job_type",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Filter jobs by type (e.g. Full Time, Part Time, Contract).",
            },
            {
              name: "per_page",
              in: "query",
              required: false,
              schema: {
                type: "integer",
                default: 5,
                minimum: 1,
                maximum: 20,
              },
              description: "Number of jobs per page (default 5, max 20).",
            },
            {
              name: "page",
              in: "query",
              required: false,
              schema: {
                type: "integer",
                default: 1,
              },
              description: "Page number for pagination.",
            },
          ],
          responses: {
            200: {
              description: "Successful response with optimized job listings",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: {
                        type: "boolean",
                        description: "Request success status",
                      },
                      count: {
                        type: "integer",
                        description: "Number of jobs in current response",
                      },
                      total: {
                        type: "integer",
                        description: "Total number of jobs available",
                      },
                      totalPages: {
                        type: "integer",
                        description: "Total pages available",
                      },
                      currentPage: {
                        type: "integer",
                        description: "Current page number",
                      },
                      jobs: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: {
                              type: "integer",
                              description: "Unique job ID",
                            },
                            slug: {
                              type: "string",
                              description: "Job slug identifier",
                            },
                            title: {
                              type: "string",
                              description: "Job title",
                            },
                            employer: {
                              type: "string",
                              description: "Employer or organization name",
                            },
                            employerLogo: {
                              type: "string",
                              description: "URL of employer logo image",
                            },
                            employerUrl: {
                              type: "string",
                              description: "URL to employer profile page",
                            },
                            location: {
                              type: "string",
                              description: "Job location(s)",
                            },
                            jobType: {
                              type: "string",
                              description:
                                "Job type (Full Time, Part Time, etc.)",
                            },
                            category: {
                              type: "string",
                              description:
                                "Job category (e.g., Management Team, Coaching, etc.)",
                            },
                            qualification: {
                              type: "string",
                              description: "Required qualification",
                            },
                            experience: {
                              type: "string",
                              description:
                                "Required experience (e.g., 2 Years, 5+ Years)",
                            },
                            salary: {
                              type: "string",
                              description: "Salary range or amount",
                            },
                            description: {
                              type: "string",
                              description:
                                "Brief job description (first 800 chars, no HTML)",
                            },
                            postedDate: {
                              type: "string",
                              description: "Date when job was posted",
                            },
                            link: {
                              type: "string",
                              description: "Direct link to full job posting",
                            },
                            fullDescriptionUrl: {
                              type: "string",
                              description: "URL for complete job details",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 SportsNaukri API Middleware running on port ${PORT}`);
  console.log(`📍 API endpoint: http://localhost:${PORT}/api/jobs`);
  console.log(`📄 OpenAPI spec: http://localhost:${PORT}/api/openapi.json`);
  console.log(`🔗 Source API: ${WORDPRESS_API_URL}`);
});
