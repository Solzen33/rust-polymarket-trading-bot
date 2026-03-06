markdown

# 🚀 Pump.Fun Comment Bot – Solana Auto Shill & Engagement Tool

[![Solana](https://img.shields.io/badge/Solana-Devnet/Mainnet-9945FF?style=flat&logo=solana)](https://solana.com)
[![Node.js](https://img.shields.io/badge/Node.js-20+-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
![GitHub stars](https://img.shields.io/github/stars/Solzen33/pumpfun-comment-bot?style=social)
![GitHub forks](https://img.shields.io/github/forks/Solzen33/pumpfun-comment-bot?style=social)

**Pump.fun comment bot** — an open-source automated tool for **Solana Pump.fun** that posts hype comments, builds threads, and shills tokens to boost visibility and engagement. Supports **Thread mode** (conversation building), **Shill mode** (spam on new/trending tokens), fresh wallet rotation, image uploads, and captcha solving.

Perfect for memecoin creators wanting to generate activity, create FOMO, or simulate community vibes on pump.fun launches.

**⚠️ WARNING**  
This tool involves automated engagement which may violate Pump.fun's terms → risk of shadow-bans, account restrictions, or token penalties.  
Use at your own risk. For **educational & testing purposes** only. Not financial advice. Never use real funds without understanding risks.



## 📱 Social Media

### Stay Connected
| Platform | Link | Purpose |
|----------|------|---------|
| Telegram | [t.me/solzen33](https://t.me/solzen77) | Announcements & Support |
| X | [x.com/solzen33](https://x.com/solzen77) | News & Updates |

## 📹 Sample Videos

Check out these demonstration videos to see the bot in action:

- [PumpFun Comment Bot Demo 1](https://drive.google.com/file/d/12cG11VyLE6QJ4brn6ijQSG1RTurBAqwY/view?usp=drive_link)
- [PumpFun Comment Bot Demo 2](https://drive.google.com/file/d/1XdBldd3p7P6iQfXJ6y13gSLwdjxYmmND/view?usp=drive_link)

## Features

- **Automated Commenting**: Post comments automatically on PumpFun token pages
- **Smart Timing**: Configurable comment intervals and timing strategies
- **Template System**: Customizable comment templates with dynamic content
- **Multi-Account Support**: Manage multiple accounts for increased engagement
- **Anti-Detection**: Built-in features to avoid detection and maintain account safety
- **Analytics**: Track comment performance and engagement metrics
- **Customizable Settings**: Fine-tune bot behavior and appearance
- **Easy Configuration**: Simple setup with user-friendly interface

## Supported Platforms

- PumpFun (Primary platform)
- Compatible with Solana-based token projects
- Extensible for other social platforms

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# PumpFun Configuration
PUMPFUN_API_URL=https://frontend-api.pump.fun
PUMPFUN_WEBSOCKET_URL=wss://frontend-api.pump.fun

# Bot Configuration
COMMENT_INTERVAL=30000
MAX_COMMENTS_PER_HOUR=20
ACCOUNT_DELAY_MIN=5000
ACCOUNT_DELAY_MAX=15000

# Comment Templates
COMMENT_TEMPLATES=template1,template2,template3
RANDOMIZE_TEMPLATES=true

# Account Management
ACCOUNTS_FILE=accounts.json
ACCOUNT_ROTATION=true

# Safety Settings
ANTI_DETECTION=true
HUMAN_LIKE_DELAYS=true
RANDOM_TYPING_SPEED=true

# Logging
LOG_LEVEL=info
```

## Installation

1. Clone the repository
```bash
git clone <repository-url>
cd pumpfun-comment-bot
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables
```bash
cp config.example.env .env
# Edit .env with your configuration
```

4. Set up accounts
```bash
# Create accounts.json file with your PumpFun accounts
# See accounts.example.json for format
```

5. Build the project
```bash
npm run build
```

## Usage

### Start the bot
```bash
npm start
```

### Development mode
```bash
npm run dev
```

### Interactive Menu

The bot provides an interactive CLI with the following options:

1. **Show Current Settings** - Display current configuration
2. **Settings** - Configure bot parameters
   - Comment templates
   - Timing intervals
   - Account management
   - Safety settings
3. **Start Commenting** - Begin automated commenting
4. **Manage Accounts** - Add/remove accounts
5. **View Analytics** - Check comment performance
6. **Exit** - Close the application

## Comment Strategy

### Smart Commenting
- Automatically posts comments on PumpFun token pages
- Uses configurable templates with dynamic content
- Implements human-like timing and behavior patterns

### Account Management
- Multi-account support for increased engagement
- Account rotation to avoid detection
- Random delays between account switches

### Safety Features
- Anti-detection mechanisms
- Human-like typing speeds
- Randomized comment intervals
- Account cooldown periods

## Configuration

### Settings File
The bot uses `settings.json` to store bot parameters:

```json
{
  "commentTemplates": [
    "Great project! 🚀",
    "This looks promising! 💎",
    "Amazing work team! 🔥"
  ],
  "commentInterval": 30000,
  "maxCommentsPerHour": 20,
  "accountRotation": true
}
```

### Bot Parameters
- **Comment Templates**: Predefined comment messages
- **Timing Intervals**: Delay between comments
- **Account Management**: Multi-account configuration
- **Safety Settings**: Anti-detection parameters

## Architecture

```
src/
├── constants/          # Configuration constants
├── layout/            # Comment posting logic
├── menu/              # CLI interface
├── types/             # TypeScript type definitions
├── utils/             # Utility functions
├── templates/         # Comment templates
└── accounts/          # Account management
```

## Dependencies

- **axios**: HTTP requests to PumpFun API
- **ws**: WebSocket connections
- **pino**: Structured logging
- **chalk**: Terminal styling
- **inquirer**: Interactive prompts

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC License - see LICENSE file for details

## Disclaimer

This software is for educational and research purposes only. Trading cryptocurrencies involves substantial risk of loss and is not suitable for all investors. The past performance of any trading system or methodology is not necessarily indicative of future results.

## Support

For issues and questions:
- Create an issue in the repository
- Check the documentation
- Review the configuration examples

## Version History

- **v2.0.0**: PumpFun Comment Bot with advanced features
- **v1.x**: Basic commenting functionality
