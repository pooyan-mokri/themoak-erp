#!/bin/bash
npm run dev > dev.log 2>&1 &
echo $! > dev_pid.txt
echo "Started dev server with PID $(cat dev_pid.txt)"
