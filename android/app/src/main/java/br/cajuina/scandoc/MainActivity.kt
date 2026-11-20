package br.cajuina.scandoc

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    /* scanner do Google (ML Kit): recorte automático, endireita, tira sombra, devolve PDF */
    private val scanLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (res.resultCode == Activity.RESULT_OK) {
            val r = GmsDocumentScanningResult.fromActivityResultIntent(res.data)
            val pdf = r?.pdf
            if (pdf != null) sendPdf(pdf.uri, pdf.pageCount) else js("window.__nsCancel&&window.__nsCancel()")
        } else js("window.__nsCancel&&window.__nsCancel()")
    }

    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val uris = WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data)
        val clip = res.data?.clipData
        val list = if (clip != null && clip.itemCount > 1) Array(clip.itemCount) { clip.getItemAt(it).uri } else uris
        fileCallback?.onReceiveValue(list); fileCallback = null
    }

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }

    private fun sendPdf(uri: Uri, pages: Int) {
        Thread {
            try {
                val bytes = contentResolver.openInputStream(uri)!!.use { it.readBytes() }
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                js("window.__nsBegin&&window.__nsBegin()")
                val step = 400_000
                var i = 0
                while (i < b64.length) { val part = b64.substring(i, minOf(b64.length, i + step)); js("window.__nsChunk('$part')"); i += step }
                js("window.__nsEnd&&window.__nsEnd($pages,${bytes.size})")
            } catch (e: Exception) { js("window.__nsCancel&&window.__nsCancel()") }
        }.start()
    }

    inner class Bridge {
        @JavascriptInterface fun scan() = runOnUiThread {
            val opts = GmsDocumentScannerOptions.Builder()
                .setGalleryImportAllowed(true)
                .setPageLimit(30)
                .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
                .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                .build()
            GmsDocumentScanning.getClient(opts).getStartScanIntent(this@MainActivity)
                .addOnSuccessListener { scanLauncher.launch(IntentSenderRequest.Builder(it).build()) }
                .addOnFailureListener { e -> js("window.__nsError&&window.__nsError(" + org.json.JSONObject.quote(e.message ?: "erro") + ")") }
        }
        @JavascriptInterface fun available(): Boolean = true
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#E8730C")
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
        }
        web.addJavascriptInterface(Bridge(), "AndroidScan")
        web.webViewClient = WebViewClient()
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView?, cb: ValueCallback<Array<Uri>>?, p: FileChooserParams?): Boolean {
                fileCallback?.onReceiveValue(null); fileCallback = cb
                return try { fileLauncher.launch(p!!.createIntent()); true } catch (e: Exception) { fileCallback = null; false }
            }
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })
        if (savedInstanceState == null) web.loadUrl("https://scan-cajuina.github.io/scandoc/?app=1") else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
}
