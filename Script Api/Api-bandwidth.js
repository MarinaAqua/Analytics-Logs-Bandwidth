const ACC = [
  {
    email: "YOUR_EMAIL_CLOUDFLARE",
    apiKey: "YOUR_API_KEY",
    accountId: "YOUR_ACCOUNT_ID"
  }
];

// Helper functions
function formatBandwidth(bytes) {
  if (bytes === 0) return "0 B";
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function getReqBw(email, apiKey, accountId) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Format tanggal: ambil bagian tanggal (YYYY-MM-DD)
  const formatDate = (date) => date.toISOString().split('T')[0];
  const hari_ini = formatDate(today);
  const hari_kemarin = formatDate(new Date(today.getTime() - 86400000));
  const sevenDaysAgo = formatDate(new Date(today.getTime() - 6 * 86400000));
  const thirtyDaysAgo = formatDate(new Date(today.getTime() - 29 * 86400000));
  const tahunLalu = formatDate(new Date(today.getTime() - 364 * 86400000));

  // Query untuk 365 hari terakhir (mencakup semua data)
  const query = `
    query {
      viewer {
        accounts(filter: { accountTag: "${accountId}" }) {
          httpRequests1dGroups(
            filter: { 
              date_geq: "${tahunLalu}", 
              date_leq: "${hari_ini}" 
            }, 
            limit: 365,
            orderBy: [date_DESC]
          ) {
            dimensions { date }
            sum {
              bytes
              cachedBytes
              requests
              cachedRequests
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Email': email,
        'X-Auth-Key': apiKey
      },
      body: JSON.stringify({ query })
    });

    const data = await response.json();
    if (data.errors) throw new Error(JSON.stringify(data.errors));

    const accountData = data.data?.viewer?.accounts?.[0];
    if (!accountData || !accountData.httpRequests1dGroups) {
      throw new Error("No data available");
    }

    const allData = accountData.httpRequests1dGroups;

    // 1. Data Harian (2 hari terakhir)
    const dailyData = allData.filter(d => 
      d.dimensions.date === hari_ini || d.dimensions.date === hari_kemarin
    ).map(d => ({
      tanggal: d.dimensions.date,
      bandwidth: (d.sum.bytes || 0) + (d.sum.cachedBytes || 0),
      requests: (d.sum.requests || 0) + (d.sum.cachedRequests || 0)
    }));

    // 2. Data Mingguan (7 hari terakhir)
    const weeklyData = allData.filter(d => d.dimensions.date >= sevenDaysAgo);
    const weeklyBandwidth = weeklyData.reduce((sum, d) => sum + (d.sum.bytes || 0) + (d.sum.cachedBytes || 0), 0);
    const weeklyRequests = weeklyData.reduce((sum, d) => sum + (d.sum.requests || 0) + (d.sum.cachedRequests || 0), 0);

    // 3. Data Bulanan (30 hari terakhir)
    const monthlyData = allData.filter(d => d.dimensions.date >= thirtyDaysAgo);
    const monthlyBandwidth = monthlyData.reduce((sum, d) => sum + (d.sum.bytes || 0) + (d.sum.cachedBytes || 0), 0);
    const monthlyRequests = monthlyData.reduce((sum, d) => sum + (d.sum.requests || 0) + (d.sum.cachedRequests || 0), 0);

    // 4. Data Total (365 hari terakhir)
    const totalBandwidth = allData.reduce((sum, d) => sum + (d.sum.bytes || 0) + (d.sum.cachedBytes || 0), 0);
    const totalRequests = allData.reduce((sum, d) => sum + (d.sum.requests || 0) + (d.sum.cachedRequests || 0), 0);

    // Kembalikan data tanpa accountId dan ID lainnya
    return {
      daily: dailyData.map(d => ({
        tanggal: d.tanggal,
        bandwidth: formatBandwidth(d.bandwidth),
        requests: formatNumber(d.requests)
      })),
      weekly: {
        periode: `${sevenDaysAgo} hingga ${hari_ini}`,
        bandwidth: formatBandwidth(weeklyBandwidth),
        requests: formatNumber(weeklyRequests)
      },
      monthly: {
        periode: `${thirtyDaysAgo} hingga ${hari_ini}`,
        bandwidth: formatBandwidth(monthlyBandwidth),
        requests: formatNumber(monthlyRequests)
      },
      total: {
        periode: `${tahunLalu} hingga ${hari_ini}`,
        bandwidth: formatBandwidth(totalBandwidth),
        requests: formatNumber(totalRequests)
      }
    };
  } catch (err) {
    return {
      error: err.message,
      daily: [],
      weekly: { periode: "", bandwidth: "0 B", requests: "0" },
      monthly: { periode: "", bandwidth: "0 B", requests: "0" },
      total: { periode: "", bandwidth: "0 B", requests: "0" }
    };
  }
}

export default {
  async fetch(request) {
    // Handle CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        }
      });
    }

    const results = await getReqBw(ACC[0].email, ACC[0].apiKey, ACC[0].accountId);
    return new Response(JSON.stringify(results, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
