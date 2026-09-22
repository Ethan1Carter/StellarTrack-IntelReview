function responseMiddleware(req, res, next) {
  res.success = function (data = null, message = '操作成功') {
    return res.status(200).json({
      code: 200,
      success: true,
      message,
      data
    });
  };

  res.error = function (code = 500, message = '服务器内部错误') {
    const statusCode = code >= 100 && code < 600 ? code : 500;
    return res.status(statusCode).json({
      code,
      success: false,
      message,
      data: null
    });
  };

  next();
}

module.exports = responseMiddleware;
