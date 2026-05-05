# Apple Detection Mini Program Frontend

一个基于微信小程序的苹果检测前端项目，用于配合 Flask 后端完成图片上传、目标检测、历史记录查看、模型切换和用户管理等功能。

## 项目简介

本项目是一个课程作业性质的微信小程序前端，主要实现了苹果图片检测的完整交互流程。  
用户可以登录账号后上传单张或多张图片，调用后端检测接口获取结果图和苹果数量，并查看按组保存的历史记录。

## 主要功能

- 账号注册与登录
- 微信临时 openid 登录
- 单张或多张图片上传
- 展示检测结果图片
- 显示每张图片的苹果数量
- 显示一组图片的图片总数和苹果总数
- 历史记录按“组”保存
- 点击历史记录后查看组内每张图片详情
- 切换当前使用的检测模型
- 修改当前用户用户名和密码
- 清空历史记录

## 页面结构

### 1. 首页 `pages/index/index`

主要功能：

- 用户登录 / 注册
- 微信临时 openid 登录
- 选择图片并上传检测
- 展示检测结果
- 展示分组历史记录
- 跳转到“其它”页面
- 跳转到“当前模型”页面

### 2. 其它页面 `pages/message/message`

主要功能：

- 显示当前登录用户信息
- 显示当前用户名
- 修改用户名和密码

### 3. 当前模型页面 `pages/currentmodel/currentmodel`

主要功能：

- 获取当前使用模型
- 展示可选模型列表
- 切换当前模型

## 当前支持的模型

前端内置了 3 个模型选项，对应后端模型配置接口：

- `yolo11s_from_previous_v3_best`
- `yolo5n_test`
- `yolo8n_test`

默认模型为：

- `yolo11s_from_previous_v3_best`

## 项目结构

```text
front_end_test/
├─ app.js
├─ app.json
├─ app.wxss
├─ project.config.json
├─ utils/
│  └─ config.js
├─ images/
│  ├─ background.jpg
│  ├─ share-default.jpg
│  ├─ train-chart.png
│  └─ user-icon.png
└─ pages/
   ├─ index/
   ├─ message/
   └─ currentmodel/
