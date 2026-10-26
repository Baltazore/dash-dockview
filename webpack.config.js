const path = require('path');

module.exports = {
    mode: 'production',
    entry: './src/ts/index.ts',
    output: {
        path: path.resolve(__dirname, 'dash_dockview'),
        filename: 'dash_dockview.js',
        library: {
            name: 'dash_dockview',
            type: 'window',
        },
    },
    externals: {
        react: 'React',
        'react-dom': 'ReactDOM',
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /(node_modules|\.test\.tsx?$)/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        onlyCompileBundledFiles: true,
                        compilerOptions: {noEmit: false},
                    },
                },
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
            },
        ],
    },
    performance: {hints: false},
};
