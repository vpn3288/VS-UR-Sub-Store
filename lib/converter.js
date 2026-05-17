/**
 * 订阅内容转换器
 * 支持 Base64、Clash、Surge、V2Ray 等格式互转
 */

class SubscriptionConverter {
  /**
   * 自动检测订阅格式
   */
  static detectFormat(content) {
    const trimmed = content.trim();
    
    // Base64 编码的节点列表
    if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
      try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
        if (decoded.includes('://')) {
          return 'base64';
        }
      } catch (e) {
        // 不是有效的 Base64
      }
    }
    
    // Clash YAML
    if (trimmed.includes('proxies:') || trimmed.includes('proxy-groups:')) {
      return 'clash';
    }
    
    // Surge
    if (trimmed.includes('[Proxy]') || trimmed.includes('[Proxy Group]')) {
      return 'surge';
    }
    
    // V2Ray JSON
    if (trimmed.startsWith('{') && trimmed.includes('outbounds')) {
      return 'v2ray';
    }
    
    // SIP002 URI 列表
    if (trimmed.includes('ss://') || trimmed.includes('vmess://') || trimmed.includes('trojan://')) {
      return 'uri';
    }
    
    return 'unknown';
  }

  /**
   * 转换订阅格式
   */
  static async convert(content, targetFormat) {
    const sourceFormat = this.detectFormat(content);
    
    if (sourceFormat === 'unknown') {
      throw new Error('Unknown subscription format');
    }
    
    // 如果目标格式是 auto，返回原内容
    if (targetFormat === 'auto') {
      return content;
    }
    
    // 解析为统一的节点对象数组
    let nodes = [];
    
    switch (sourceFormat) {
      case 'base64':
        nodes = this.parseBase64(content);
        break;
      case 'clash':
        nodes = this.parseClash(content);
        break;
      case 'surge':
        nodes = this.parseSurge(content);
        break;
      case 'v2ray':
        nodes = this.parseV2Ray(content);
        break;
      case 'uri':
        nodes = this.parseURI(content);
        break;
    }
    
    // 转换为目标格式
    switch (targetFormat) {
      case 'clash':
        return this.toClash(nodes);
      case 'surge':
        return this.toSurge(nodes);
      case 'v2ray':
        return this.toV2Ray(nodes);
      case 'base64':
        return this.toBase64(nodes);
      default:
        return content;
    }
  }

  /**
   * 解析 Base64 编码的 URI 列表
   */
  static parseBase64(content) {
    try {
      const decoded = Buffer.from(content.trim(), 'base64').toString('utf-8');
      return this.parseURI(decoded);
    } catch (error) {
      throw new Error('Invalid Base64 content');
    }
  }

  /**
   * 解析 URI 列表（ss://、vmess://、trojan:// 等）
   */
  static parseURI(content) {
    const lines = content.split('\n').filter(line => line.trim());
    const nodes = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('ss://')) {
        nodes.push(this.parseShadowsocksURI(trimmed));
      } else if (trimmed.startsWith('vmess://')) {
        nodes.push(this.parseVMessURI(trimmed));
      } else if (trimmed.startsWith('trojan://')) {
        nodes.push(this.parseTrojanURI(trimmed));
      }
    }
    
    return nodes.filter(n => n !== null);
  }

  /**
   * 解析 Shadowsocks URI
   */
  static parseShadowsocksURI(uri) {
    try {
      const url = new URL(uri);
      const decoded = Buffer.from(url.username, 'base64').toString('utf-8');
      const [method, password] = decoded.split(':');
      
      return {
        type: 'ss',
        name: decodeURIComponent(url.hash.slice(1)) || url.hostname,
        server: url.hostname,
        port: parseInt(url.port, 10),
        cipher: method,
        password: password,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 解析 VMess URI
   */
  static parseVMessURI(uri) {
    try {
      const json = JSON.parse(Buffer.from(uri.slice(8), 'base64').toString('utf-8'));
      
      return {
        type: 'vmess',
        name: json.ps || json.add,
        server: json.add,
        port: parseInt(json.port, 10),
        uuid: json.id,
        alterId: parseInt(json.aid || '0', 10),
        cipher: json.scy || 'auto',
        network: json.net || 'tcp',
        tls: json.tls === 'tls',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 解析 Trojan URI
   */
  static parseTrojanURI(uri) {
    try {
      const url = new URL(uri);
      
      return {
        type: 'trojan',
        name: decodeURIComponent(url.hash.slice(1)) || url.hostname,
        server: url.hostname,
        port: parseInt(url.port, 10),
        password: url.username,
        sni: url.searchParams.get('sni') || url.hostname,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 解析 Clash YAML（简化版）
   */
  static parseClash(content) {
    // 这里需要完整的 YAML 解析器，简化实现
    // 实际生产环境建议使用 js-yaml 库
    const nodes = [];
    const lines = content.split('\n');
    
    let inProxies = false;
    let currentNode = null;
    
    for (const line of lines) {
      if (line.trim() === 'proxies:') {
        inProxies = true;
        continue;
      }
      
      if (inProxies && line.startsWith('  - ')) {
        if (currentNode) nodes.push(currentNode);
        currentNode = {};
      }
      
      if (inProxies && currentNode && line.includes(':')) {
        const [key, ...valueParts] = line.trim().split(':');
        const value = valueParts.join(':').trim();
        currentNode[key] = value;
      }
      
      if (line.trim() === 'proxy-groups:') {
        if (currentNode) nodes.push(currentNode);
        break;
      }
    }
    
    return nodes;
  }

  /**
   * 解析 Surge 配置（简化版）
   */
  static parseSurge(content) {
    const nodes = [];
    const lines = content.split('\n');
    let inProxy = false;
    
    for (const line of lines) {
      if (line.trim() === '[Proxy]') {
        inProxy = true;
        continue;
      }
      
      if (line.trim().startsWith('[') && inProxy) {
        break;
      }
      
      if (inProxy && line.includes('=')) {
        // 解析 Surge 代理行
        const [name, config] = line.split('=').map(s => s.trim());
        const parts = config.split(',').map(s => s.trim());
        
        if (parts[0] === 'ss') {
          nodes.push({
            type: 'ss',
            name,
            server: parts[1],
            port: parseInt(parts[2], 10),
            cipher: parts[3],
            password: parts[4],
          });
        }
      }
    }
    
    return nodes;
  }

  /**
   * 解析 V2Ray JSON（简化版）
   */
  static parseV2Ray(content) {
    try {
      const config = JSON.parse(content);
      const nodes = [];
      
      if (config.outbounds) {
        for (const outbound of config.outbounds) {
          if (outbound.protocol === 'vmess') {
            const server = outbound.settings.vnext[0];
            nodes.push({
              type: 'vmess',
              name: outbound.tag || server.address,
              server: server.address,
              port: server.port,
              uuid: server.users[0].id,
              alterId: server.users[0].alterId || 0,
            });
          }
        }
      }
      
      return nodes;
    } catch (error) {
      return [];
    }
  }

  /**
   * 转换为 Clash YAML
   */
  static toClash(nodes) {
    let yaml = 'proxies:\n';
    
    for (const node of nodes) {
      yaml += \`  - name: "\${node.name}"\n\`;
      yaml += \`    type: \${node.type}\n\`;
      yaml += \`    server: \${node.server}\n\`;
      yaml += \`    port: \${node.port}\n\`;
      
      if (node.type === 'ss') {
        yaml += \`    cipher: \${node.cipher}\n\`;
        yaml += \`    password: "\${node.password}"\n\`;
      } else if (node.type === 'vmess') {
        yaml += \`    uuid: \${node.uuid}\n\`;
        yaml += \`    alterId: \${node.alterId}\n\`;
        yaml += \`    cipher: \${node.cipher || 'auto'}\n\`;
      } else if (node.type === 'trojan') {
        yaml += \`    password: "\${node.password}"\n\`;
        yaml += \`    sni: \${node.sni}\n\`;
      }
    }
    
    return yaml;
  }

  /**
   * 转换为 Surge 配置
   */
  static toSurge(nodes) {
    let config = '[Proxy]\n';
    
    for (const node of nodes) {
      if (node.type === 'ss') {
        config += \`\${node.name} = ss, \${node.server}, \${node.port}, encrypt-method=\${node.cipher}, password=\${node.password}\n\`;
      } else if (node.type === 'trojan') {
        config += \`\${node.name} = trojan, \${node.server}, \${node.port}, password=\${node.password}, sni=\${node.sni}\n\`;
      }
    }
    
    return config;
  }

  /**
   * 转换为 V2Ray JSON
   */
  static toV2Ray(nodes) {
    const config = {
      outbounds: []
    };
    
    for (const node of nodes) {
      if (node.type === 'vmess') {
        config.outbounds.push({
          protocol: 'vmess',
          tag: node.name,
          settings: {
            vnext: [{
              address: node.server,
              port: node.port,
              users: [{
                id: node.uuid,
                alterId: node.alterId || 0,
              }]
            }]
          }
        });
      }
    }
    
    return JSON.stringify(config, null, 2);
  }

  /**
   * 转换为 Base64 编码的 URI 列表
   */
  static toBase64(nodes) {
    const uris = [];
    
    for (const node of nodes) {
      if (node.type === 'ss') {
        const userinfo = Buffer.from(\`\${node.cipher}:\${node.password}\`).toString('base64');
        uris.push(\`ss://\${userinfo}@\${node.server}:\${node.port}#\${encodeURIComponent(node.name)}\`);
      } else if (node.type === 'vmess') {
        const vmessObj = {
          v: '2',
          ps: node.name,
          add: node.server,
          port: node.port.toString(),
          id: node.uuid,
          aid: (node.alterId || 0).toString(),
          net: node.network || 'tcp',
          type: 'none',
          tls: node.tls ? 'tls' : '',
        };
        const vmessJson = Buffer.from(JSON.stringify(vmessObj)).toString('base64');
        uris.push(\`vmess://\${vmessJson}\`);
      } else if (node.type === 'trojan') {
        uris.push(\`trojan://\${node.password}@\${node.server}:\${node.port}?sni=\${node.sni}#\${encodeURIComponent(node.name)}\`);
      }
    }
    
    return Buffer.from(uris.join('\n')).toString('base64');
  }
}

module.exports = SubscriptionConverter;
