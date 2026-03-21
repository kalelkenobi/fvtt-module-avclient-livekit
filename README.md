# LiveKit AVClient

## About

A replacement for the native SimplePeer / EasyRTC A/V client in FoundryVTT. The module uses [LiveKit](https://livekit.io/) platform to provide Audio & Video communication between players.

> :warning: **SSL is still required**
>
> The LiveKit AVClient does not remove the need for SSL (https) on your Foundry server. All modern browsers require that the page that A/V is viewed on be secured. You can follow the following guide to set up SSL on your Foundry server: [Foundry VTT - SSL & HTTPS](https://foundryvtt.com/article/ssl/)

**Note:** _You must configure a custom LiveKit signaling server under Audio/Video communication. See [Running your own LiveKit server](#running-your-own-livekit-server) below, or use one of the following hosted options:_

[LiveKit Cloud](https://livekit.io/) provides a free tier, for a limited number of minutes/bandwidth per month. It may not be suitable for larger games or frequent use.

## Installation

You can install this module by using the following manifest URL: https://github.com/kalelkenobi/fvtt-module-avclient-livekit/releases/latest/download/module.json

## Configuration

Install & enable the module then configure for your LiveKit instance under Audio/Video Configuration:

**LiveKit Server Address:** `rtc.example.com` \<Your LiveKit server address\>  
**LiveKit API Key:** `ABCDEFGHIJ12345` \<Your LiveKit API Key>  
**LiveKit Secret Key:** `****************` \<Your LiveKit Secret Key\>

## Features

LiveKit AVClient provides a number of features beyond the A/V option built into Foundry:

- Uses a Selective Forwarding Unit (SFU) architecture instead of Mesh. This means each user only has to send their their audio and video once instead of needing to connect to every other user in the game.
- LiveKit server connections work in more network environments.
- [Breakout Rooms](#breakout-rooms) allow you to split the party!
- Adaptive Streaming and Dynamic Broadcasting reduce bandwidth and CPU usage based on video window size and available system resources.
- Opus DTX reduces bandwidth used by audio tracks when a user isn't speaking.
- A Connection Quality Indicator shows if a user's connection is having trouble.
- An optional external web client can be used to open audio and video in a separate tab, or even separate device (including mobile).
- The ability for individual users to disable receiving video in case they are on very limited connections.
- The ability to individually hide or mute users only for yourself.
- Advanced Audio Mode to tune audio publishing settings for audio streamed by your account.

## How to use

### **Breakout Rooms**

A GM can now split the party!

To start a breakout room, right-click on the player you would like to break out in the player list and select `Start A/V breakout`. You will join a different A/V session with that user. You can now right-click on other users and pull them into the breakout room, or start yet another breakout room with another user.

Though the GM will always join the breakout room on creation, they can leave the breakout room themselves by right-clicking on their own username and selecting `Leave A/V Breakout`. Users can also leave a breakout at any time by right-clicking on their own name, and the GM can end all breakout rooms by selecting `End all A/V breakouts`.

## Debugging

By default, debug logs are disabled. If additional logs are needed for troubleshooting, `Enable debug logging` can be turned on under the module settings. For even more logging of the LiveKit connection, LiveKit trace logging can be enabled after debugging logging is turned on by setting `Enable LiveKit trace logging` under module settings.

## Credits

This project is a fork of the original [LiveKit AVClient](https://github.com/bekriebel/fvtt-module-avclient-livekit) module created by [bekit](https://github.com/bekriebel). All credit for the original code goes to [bekit](https://github.com/bekriebel).

## Changelog

See [CHANGELOG](/CHANGELOG.md)
