const http = require("http");
function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: "127.0.0.1", port: 3000, path, method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } };
    const r = http.request(opts, res => { let d=""; res.on("data",c=>d+=c); res.on("end",()=>{try{resolve({status:res.statusCode,body:JSON.parse(d)})}catch(e){resolve({status:res.statusCode,raw:d})}});});
    r.on("error", reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
(async () => {
  // Step 1: Login as student with approved apps
  const login = await req("POST", "/api/auth/login", null, { username: "s_e2e_1787004511601_1", password: "123456" });
  const token = login.body?.data?.token;
  const sid = login.body?.data?.user?.id;
  console.log("Step 1: Student login, id =", sid);

  // Step 2: Get semester list (simulates frontend getMySemesters)
  const semResp = await req("GET", "/api/applications/my/semesters", token, null);
  const semList = semResp.body?.data || [];
  console.log("\nStep 2: Semester list from API:");
  semList.forEach(s => {
    // Simulate frontend mapping
    const value = `${s.academicYear}|${s.semester}`;
    console.log(`  raw semester="${s.semester}" → frontend value="${value}"`);
  });

  // Step 3: Simulate frontend split and API call for each semester
  console.log("\nStep 3: Simulating frontend→backend flow for each semester:");
  for (const s of semList) {
    const frontendValue = `${s.academicYear}|${s.semester}`;
    // Simulate: const [ay, sem] = selectedSemester.value.split('|');
    const [ay, sem] = frontendValue.split('|');
    console.log(`  frontend value="${frontendValue}" → split → academicYear="${ay}" semester="${sem}"`);

    // Call backend with these params
    const r = await req("GET", `/api/stats/dashboard/individual?studentId=${sid}&academicYear=${ay}&semester=${sem}`, token, null);
    const d = r.body?.data || {};
    console.log(`    → backend: totalScore=${d.totalScore} appCount=${d.appCount} categoryData=${JSON.stringify(d.categoryData)}`);
  }

  // Step 4: Verify database values match
  console.log("\nStep 4: Cross-check with /student/dashboard endpoint (same params):");
  for (const s of semList) {
    const r = await req("GET", `/api/stats/student/dashboard?academicYear=${s.academicYear}&semester=${s.semester}`, token, null);
    const d = r.body?.data || {};
    console.log(`  semester="${s.semester}" → totalScore=${d.totalScore} appCount=${d.appCount}`);
  }

  // Step 5: Test wrong format (old bug: '1'/'2') to confirm it returns empty
  console.log("\nStep 5: Verify old wrong format '1'/'2' returns 0 (confirms fix):");
  const wrongFormat = await req("GET", `/api/stats/dashboard/individual?studentId=${sid}&academicYear=2025-2026&semester=2`, token, null);
  const wd = wrongFormat.body?.data || {};
  console.log(`  semester="2" → totalScore=${wd.totalScore} appCount=${wd.appCount} (should be 0 - no match)`);
  const correctFormat = await req("GET", `/api/stats/dashboard/individual?studentId=${sid}&academicYear=2025-2026&semester=second`, token, null);
  const cd = correctFormat.body?.data || {};
  console.log(`  semester="second" → totalScore=${cd.totalScore} appCount=${cd.appCount} (should have data)`);
})();
