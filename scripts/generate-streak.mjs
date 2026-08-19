// Generates assets/streak.svg from live GitHub contribution data.
// Run by .github/workflows/streak.yml on a daily schedule.

const USERNAME = process.env.GH_USERNAME || "apun16";
// A PAT with read:user scope is required for private contributions to be
// counted; the Actions-provided GITHUB_TOKEN only ever sees public ones.
const TOKEN = process.env.GH_PAT || process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error("Missing GH_PAT / GITHUB_TOKEN");
  process.exit(1);
}

if (!process.env.GH_PAT) {
  console.warn("GH_PAT not set — private contributions will be excluded from the total.");
}

const QUERY = `
query($userName: String!) {
  user(login: $userName) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

async function fetchContributions() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { userName: USERNAME } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data.user.contributionsCollection.contributionCalendar;
}

function computeStreaks(weeks) {
  const days = weeks.flatMap((w) => w.contributionDays);

  // Current streak: count backwards from the most recent day. Allow today
  // to be a zero-contribution day in progress without breaking the streak.
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const isToday = i === days.length - 1;
    if (days[i].contributionCount > 0) {
      current += 1;
    } else if (isToday) {
      continue;
    } else {
      break;
    }
  }

  return { current };
}

function levelFor(count, max) {
  if (count === 0) return 0;
  const ratio = count / Math.max(max, 1);
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

const PALETTE = ["#0d1b2e", "#16305c", "#1e40af", "#2563eb", "#60a5fa"];

function buildSvg({ weeks, total, current }) {
  const cell = 16;
  const gap = 4;
  const gridLeft = 24;
  const gridTop = 28;

  const maxCount = Math.max(...weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)));

  const cells = weeks
    .map((week, wi) =>
      week.contributionDays
        .map((day, di) => {
          const x = gridLeft + wi * (cell + gap);
          const y = gridTop + di * (cell + gap);
          const level = levelFor(day.contributionCount, maxCount);
          return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" ry="2" fill="${PALETTE[level]}"><title>${day.date}: ${day.contributionCount} contributions</title></rect>`;
        })
        .join("")
    )
    .join("");

  // Stats sit below the grid: label row, then value row.
  const gridBottom = gridTop + 7 * (cell + gap) - gap;
  const labelY = gridBottom + 44;
  const valueY = labelY + 34;

  const width = gridLeft + weeks.length * (cell + gap) - gap + gridLeft;
  const height = valueY + 28;
  const totalX = 260;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="12" fill="#0a192f"/>
  ${cells}

  <text x="${gridLeft}" y="${labelY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="13" fill="#64748b" letter-spacing="1">CURRENT STREAK</text>
  <text x="${gridLeft}" y="${valueY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#93c5fd">${current}<tspan font-size="16" font-weight="400" fill="#64748b" dx="8">days</tspan></text>

  <text x="${totalX}" y="${labelY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="13" fill="#64748b" letter-spacing="1">TOTAL COMMITS IN PAST YEAR (INCL. PRIVATE)</text>
  <text x="${totalX}" y="${valueY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#3b82f6">${total.toLocaleString()}</text>
</svg>`;
}

async function main() {
  const calendar = await fetchContributions();
  const { current } = computeStreaks(calendar.weeks);
  const svg = buildSvg({
    weeks: calendar.weeks,
    total: calendar.totalContributions,
    current,
  });

  const fs = await import("node:fs/promises");
  await fs.mkdir("assets", { recursive: true });
  await fs.writeFile("assets/streak.svg", svg);
  console.log(`Wrote assets/streak.svg — current streak ${current}, total ${calendar.totalContributions}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
