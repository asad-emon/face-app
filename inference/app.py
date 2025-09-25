import gradio as gr
import torch
import numpy as np
from PIL import Image
import insightface
from insightface.app import FaceAnalysis
from insightface.data import get_image as ins_get_image

# Initialize the FaceAnalysis model
app = FaceAnalysis(name='buffalo_l')
app.prepare(ctx_id=0, det_size=(640, 640))

# Initialize the Inswapper model
swapper = insightface.model_zoo.get_model('inswapper_128.onnx', download=True, download_zip=True)

def swap_faces(source_img, target_img):
    """
    Swaps faces from a source image to a target image.
    """
    # Convert Gradio images to numpy arrays
    source_np = np.array(source_img)
    target_np = np.array(target_img)

    # Get faces from the images
    source_faces = app.get(source_np)
    target_faces = app.get(target_np)

    if not source_faces or not target_faces:
        return None, "Could not detect faces in one or both images."

    # Perform the swap
    result_img = target_np.copy()
    result_img = swapper.get(result_img, target_faces[0], source_faces[0], paste_back=True)

    return Image.fromarray(result_img), "Face swap successful!"

# Create the Gradio interface
with gr.Blocks() as demo:
    gr.Markdown("# Face Swapper")
    with gr.Row():
        source_img = gr.Image(label="Source Image")
        target_img = gr.Image(label="Target Image")
    with gr.Row():
        output_img = gr.Image(label="Result")
        status_text = gr.Textbox(label="Status")
    swap_button = gr.Button("Swap Faces")

    swap_button.click(
        fn=swap_faces,
        inputs=[source_img, target_img],
        outputs=[output_img, status_text]
    )

    gr.Examples(
        examples=[
            ["examples/source.png", "examples/target.png"],
        ],
        inputs=[source_img, target_img],
    )

if __name__ == "__main__":
    demo.launch()
