@echo off
chcp 65001 >nul
echo ============================================
echo   AI 会员价格雷达 - 构建工具站
echo ============================================
echo.
node build.mjs
echo.
if errorlevel 1 (
  echo [失败] 构建出错，请把上面的错误信息发给 AI。
) else (
  echo [成功] 页面已生成到 dist 文件夹，去托管后台重新上传即可。
)
echo.
pause
