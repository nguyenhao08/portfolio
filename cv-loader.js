/**
 * cv-loader.js — Quản lý tải dữ liệu động từ cv_data.json (và fallback cv_data.md)
 * Hỗ trợ:
 * 0. Dữ liệu Live trực tiếp từ trang Admin (localStorage: cv_data_live)
 * 1. GitHub Contents API (khi có token)
 * 2. GitHub Raw User Content (công khai)
 * 3. File local cv_data.json
 * 4. File local cv_data.md (tương thích ngược)
 */

const CV_CONFIG_KEY = 'cvAdminConfig';
const CV_LIVE_KEY = 'cv_data_live';

function getStoredCvConfig() {
  try {
    return JSON.parse(localStorage.getItem(CV_CONFIG_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

/**
 * Tải dữ liệu CV
 */
async function loadCvData() {
  const timestamp = Date.now();

  // 0. Ưu tiên dữ liệu Live từ trang Admin (nếu người dùng vừa chỉnh sửa/upload ảnh trong trình duyệt)
  try {
    let liveDraft = localStorage.getItem(CV_LIVE_KEY);
    if (liveDraft) {
      if (liveDraft.includes('Võ Nguyễn Hào')) {
        liveDraft = liveDraft.replace(/Võ Nguyễn Hào/g, 'Võ Nguyên Hào');
        try { localStorage.setItem(CV_LIVE_KEY, liveDraft); } catch (_) {}
      }
      const parsed = JSON.parse(liveDraft);
      if (parsed && (parsed.profile || parsed.projects)) {
        return {
          data: parsed,
          markdown: JSON.stringify(parsed, null, 2),
          source: 'local-live',
          lastUpdated: 'Admin Live'
        };
      }
    }
  } catch (e) {
    console.warn('Không đọc được cv_data_live:', e);
  }

  const cfg = getStoredCvConfig();
  const targetPath = cfg.path || 'cv_data.json';

  // 1. Thử lấy từ GitHub API nếu đã cấu hình
  if (cfg.owner && cfg.repo && cfg.token) {
    try {
      const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${targetPath}?ref=${cfg.branch || 'main'}&_t=${timestamp}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${cfg.token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
        cache: 'no-store'
      });
      if (res.ok) {
        const fileInfo = await res.json();
        const content = decodeURIComponent(escape(atob(fileInfo.content.replace(/\n/g, ''))));
        const now = new Date().toLocaleTimeString('vi-VN');
        
        if (targetPath.endsWith('.json') || content.trim().startsWith('{')) {
          try {
            const json = JSON.parse(content);
            return { data: json, markdown: content, source: 'github', lastUpdated: now };
          } catch (je) {
            console.warn('Lỗi parse JSON từ GitHub API, coi như raw text:', je);
          }
        }
        return { data: parseCvMarkdown(content), markdown: content, source: 'github', lastUpdated: now };
      }
    } catch (e) {
      console.warn('Không thể tải từ GitHub API, thử tải phương thức khác:', e);
    }
  }

  // 2. Thử tải từ GitHub Raw
  if (cfg.owner && cfg.repo) {
    const rawPaths = [targetPath, 'cv_data.json', 'cv_data.md'];
    for (const p of [...new Set(rawPaths)]) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || 'main'}/${p}?_t=${timestamp}`;
        const res = await fetch(rawUrl, { cache: 'no-store' });
        if (res.ok) {
          const text = await res.text();
          const now = new Date().toLocaleTimeString('vi-VN');
          if (p.endsWith('.json') || text.trim().startsWith('{')) {
            try {
              const json = JSON.parse(text);
              return { data: json, markdown: text, source: 'github-raw', lastUpdated: now };
            } catch (je) {}
          }
          return { data: parseCvMarkdown(text), markdown: text, source: 'github-raw', lastUpdated: now };
        }
      } catch (e) { /* thử tiếp */ }
    }
  }

  // 3. Tải file Local cv_data.json
  try {
    const jsonRes = await fetch(`cv_data.json?_t=${timestamp}`, { cache: 'no-store' });
    if (jsonRes.ok) {
      const json = await jsonRes.json();
      return { data: json, markdown: JSON.stringify(json, null, 2), source: 'local-json', lastUpdated: new Date().toLocaleTimeString('vi-VN') };
    }
  } catch (e) {
    // Không có cv_data.json local, thử fallback sang cv_data.md
  }

  // 4. Fallback: Tải file local cv_data.md
  try {
    const localRes = await fetch(`cv_data.md?_t=${timestamp}`, { cache: 'no-store' });
    if (localRes.ok) {
      const localText = await localRes.text();
      return { data: parseCvMarkdown(localText), markdown: localText, source: 'local-md', lastUpdated: new Date().toLocaleTimeString('vi-VN') };
    }
  } catch (e) {
    console.error('Không thể đọc file dữ liệu local:', e);
  }

  return null;
}

/**
 * Phân tích cú pháp cv_data.md (giữ lại để tương thích ngược)
 */
function parseCvMarkdown(md) {
  if (!md) return null;

  const result = {
    profile: {
      name: '',
      title: '',
      subTitle: '',
      currentRole: '',
      pmRole: '',
      contact: { location: '', phone: '', email: '', linkedin: '' },
      education: { degree: '', school: '', english: '' },
      metrics: [],
      skills: []
    },
    experiences: [],
    projects: []
  };

  const lines = md.split('\n');
  let currentSection = '';

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('# ')) {
      currentSection = line.replace(/^#\s+/, '').toUpperCase();
      continue;
    }

    if (currentSection.includes('THÔNG TIN CÁ NHÂN')) {
      if (line.startsWith('- Họ tên:')) {
        result.profile.name = line.replace('- Họ tên:', '').trim();
      } else if (line.startsWith('- Chức danh:')) {
        const parts = line.replace('- Chức danh:', '').split('|').map(s => s.trim());
        result.profile.title = parts[0] || '';
        result.profile.subTitle = parts.slice(1).join(' | ');
      } else if (line.startsWith('- Vị trí hiện tại:')) {
        result.profile.currentRole = line.replace('- Vị trí hiện tại:', '').trim();
      } else if (line.startsWith('- Vai trò PM:')) {
        result.profile.pmRole = line.replace('- Vai trò PM:', '').trim();
      } else if (line.startsWith('- Liên hệ:')) {
        const contactStr = line.replace('- Liên hệ:', '').trim();
        const parts = contactStr.split('|').map(s => s.trim());
        parts.forEach(p => {
          if (p.includes('@')) result.profile.contact.email = p;
          else if (/^\d{3,}/.test(p.replace(/\s+/g, ''))) result.profile.contact.phone = p;
          else if (p.toLowerCase().includes('linkedin')) {
            result.profile.contact.linkedin = p.replace(/^LinkedIn:\s*/i, '').trim();
          } else {
            result.profile.contact.location = p;
          }
        });
      } else if (line.startsWith('- Học vấn:')) {
        const eduStr = line.replace('- Học vấn:', '').trim();
        const parts = eduStr.split('.').map(s => s.trim()).filter(Boolean);
        result.profile.education.degree = parts[0] || '';
        if (parts[1]) result.profile.education.english = parts[1];
      }
    } else if (currentSection.includes('DỰ ÁN TRỌNG ĐIỂM')) {
      const match = line.match(/^(\d+)\.\s*(.+?):\s*(.+)$/);
      if (match) {
        const rawName = match[2].trim();
        const desc = match[3].trim();
        
        const techMatches = desc.match(/\b(Arito ERP|iPOS|S-Invoice|Vietcombank|VietinBank|VietQR|Galaxy DMS|SAML 2\.0|SSO|Open API|eKYC|LIMS|TT99|Thông tư 99|POSM|ASUPP|WMS)\b/gi) || [];
        const uniqueTechs = [...new Set(techMatches.map(t => t.trim()))];

        result.projects.push({
          id: match[1],
          client: rawName,
          description: desc,
          tags: uniqueTechs
        });
      }
    }
  }

  return result;
}
