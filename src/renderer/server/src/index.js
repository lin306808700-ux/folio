const express = require('express');
const { expressjwt: jwt } = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const cors = require('cors');
const path = require('path');

const chatRoutes = require('./routes/chat');
const memoryRoutes = require('./routes/memories');
const ideaRoutes = require('./routes/ideas');
const crawlerRoutes = require('./routes/crawler');
const copilotRoutes = require('./routes/copilot');
const skillRoutes = require('./routes/skills');

const app = express();

// 1. 深度 CORS 配置 - 确保在所有中间件之前
app.use(cors());
app.options('*', cors()); // 放行所有预检请求

app.use(express.json());

// 2. 增强型 Auth Middleware - 设置 credentialsRequired 为 false 以便在路由中手动处理
const auth = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: 'https://1d.alibaba-inc.com/.well-known/jwks.json',
  }),
  algorithms: ['RS256'],
  credentialsRequired: false
});

// 3. 链路追踪日志
app.use((req, res, next) => {
  console.log(`[Matrix Tracer] ${new Date().toLocaleTimeString()} | ${req.method} ${req.url}`);
  next();
});

// 4. 基础测试接口
app.get('/api/ping', (req, res) => res.json({ success: true, message: 'pong', version: '1.1.5' }));

// 5. 挂载业务路由
app.use('/api/chat', auth, chatRoutes);
app.use('/api/memories', auth, memoryRoutes);
app.use('/api/ideas', auth, ideaRoutes);
app.use('/api/crawler', auth, crawlerRoutes);
app.use('/api/copilot', auth, copilotRoutes);
app.use('/api/skills', auth, skillRoutes);

// 健康检查
app.get('/health', (req, res) => res.json({ status: 'UP', timestamp: new Date() }));

// 全局错误捕获
app.use((err, req, res, next) => {
  console.error('[Matrix Fatal Error]:', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: `核心矩阵同步失败: ${err.message}`,
    error_code: err.code || 'MATRIX_FAILURE'
  });
});

const PORT = 9000;
app.listen(PORT, () => {
  console.log(`Core Matrix Backend v1.1.5 active on port ${PORT}`);
});
