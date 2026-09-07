/**
 * 统一响应增强中间件
 * 为 res 挂载 success / fail / paginate 方法
 */
exports.responseEnhancer = (req, res, next) => {
  // 成功响应
  res.success = (data = null, message = '操作成功', code = 0) => {
    res.json({
      code,
      message,
      data,
      timestamp: Date.now()
    });
  };

  // 失败响应
  res.fail = (message = '操作失败', code = 1, data = null) => {
    res.json({
      code,
      message,
      data,
      timestamp: Date.now()
    });
  };

  // 分页响应
  res.paginate = (list = [], total = 0, page = 1, pageSize = 10, message = '查询成功') => {
    res.json({
      code: 0,
      message,
      data: {
        list,
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        totalPages: Math.ceil(total / pageSize) || 0
      },
      timestamp: Date.now()
    });
  };

  // 未授权
  res.unauthorized = (message = '未登录或登录已过期，请重新登录') => {
    res.status(401).json({
      code: 401,
      message,
      data: null,
      timestamp: Date.now()
    });
  };

  // 禁止访问
  res.forbidden = (message = '无权限执行此操作') => {
    res.status(403).json({
      code: 403,
      message,
      data: null,
      timestamp: Date.now()
    });
  };

  next();
};
